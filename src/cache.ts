/*!
 * 缓存层 —— 归一化 + 哈希 + 双后端(Redis 优先,降级内存 LRU)。
 *
 * 设计:
 *   1. normalizeInput(): 把语义等价的用户输入折叠成同一个规范串
 *      (去首尾空白、压缩内部空白、小写、去常见标点/全角符号),
 *      以提高缓存命中率 —— "注册" / "注册 " / "注册！" 命中同一 key。
 *   2. cacheKey(): 对 (归一化输入 + 模型 + 版本) 做 SHA-256,得到稳定 key。
 *      版本号(CACHE_VERSION)参与 key,改 prompt/模板时一改即整体失效。
 *   3. CacheStore: 统一 get/set 接口。
 *      - 配置了 REDIS_URL 且连得上 → 用 Redis(跨进程/跨实例共享,适合生产)。
 *      - 否则 → 进程内 LRU(零依赖,适合本地/clone 者直接跑)。
 *      - Redis 运行时报错 → 自动降级到 LRU,不影响主流程。
 *
 * 安全: 只缓存与具体用户无关的内容(UI 骨架/通用回复)。
 *       含 PII、session token 的内容绝不调用本模块写入。
 */
import { createHash } from 'node:crypto';

// 改这个版本号可让所有缓存立即失效(prompt/模板/输出结构变更时)。
export const CACHE_VERSION = 'v1';

// ── 归一化 ──────────────────────────────────────────────────────────────────
export function normalizeInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // 全角空格 → 半角
    .replace(/\u3000/g, ' ')
    // 压缩连续空白
    .replace(/\s+/g, ' ')
    // 去掉常见中英文标点(句末语气符号不影响意图)
    .replace(/[!！?？。.,，、;；:：~～\-_/\\]+$/g, '')
    .trim();
}

// ── 哈希 → 缓存 key ─────────────────────────────────────────────────────────
export function cacheKey(parts: {
  input: string;
  model: string;
  scope?: string;
}): string {
  const norm = normalizeInput(parts.input);
  const material = JSON.stringify({
    v: CACHE_VERSION,
    s: parts.scope || 'chat',
    m: parts.model,
    i: norm,
  });
  const hash = createHash('sha256').update(material).digest('hex').slice(0, 32);
  return `a2ui:cache:${CACHE_VERSION}:${parts.scope || 'chat'}:${hash}`;
}

// ── 统一缓存接口 ────────────────────────────────────────────────────────────
export interface CacheStore {
  readonly backend: 'redis' | 'lru';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

// 进程内 LRU(带 TTL),作为默认 / 降级后端 ──────────────────────────────────────
class LruCache implements CacheStore {
  readonly backend = 'lru' as const;
  private store = new Map<string, { value: string; expireAt: number }>();
  constructor(private max = 500) {}

  async get(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expireAt) {
      this.store.delete(key);
      return null;
    }
    // LRU: 命中后移到末尾(最近使用)
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.store.size >= this.max) {
      // 淘汰最久未使用(Map 头部)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expireAt: Date.now() + ttlSeconds * 1000 });
  }
}

// Redis 后端 —— 出错自动回退到内置 LRU ───────────────────────────────────────
class RedisCache implements CacheStore {
  readonly backend = 'redis' as const;
  private fallback = new LruCache();
  // 用 any 避免在未装/类型问题时影响 ng build
  constructor(private client: any) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      console.warn('[cache] Redis get 失败,降级 LRU:', (err as Error).message);
      return this.fallback.get(key);
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      console.warn('[cache] Redis set 失败,降级 LRU:', (err as Error).message);
      await this.fallback.set(key, value, ttlSeconds);
    }
  }
}

// ── 工厂: 按 REDIS_URL 决定后端,连不上则用 LRU ───────────────────────────────
let _store: CacheStore | undefined;

export async function getCacheStore(): Promise<CacheStore> {
  if (_store) return _store;

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    console.log('[cache] 未配置 REDIS_URL,使用进程内 LRU 缓存。');
    _store = new LruCache();
    return _store;
  }

  try {
    // 动态 import,避免无 Redis 环境下的加载/打包问题
    const { default: Redis } = await import('ioredis');
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // 连不上不要无限重连刷屏
      retryStrategy: () => null,
    });
    await client.connect();
    await client.ping();
    console.log(`[cache] 已连接 Redis (${redisUrl}),使用 Redis 缓存。`);
    _store = new RedisCache(client);
  } catch (err) {
    console.warn(
      `[cache] 连接 Redis 失败 (${(err as Error).message}),降级使用进程内 LRU 缓存。`
    );
    _store = new LruCache();
  }
  return _store;
}

// 仅供测试: 重置单例
export function _resetCacheStoreForTest(): void {
  _store = undefined;
}
