export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<T> {
  let response: Response;
  try { response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Zhujian-Client': 'local', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new ApiError('连接不到本机服务。请确认第二视角仍在运行，当前输入会留在页面上。', 0); }
  let result: any;
  try { result = await response.json(); } catch { throw new ApiError('本机服务没有返回有效内容，请检查服务是否正常运行。', response.status); }
  if (!response.ok) throw new ApiError(result.error || '操作未能完成，请重试。', response.status);
  return result as T;
}
export const dateText = (value: string, full = false) => new Date(value).toLocaleString('zh-CN', full ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'long', day: 'numeric' });
export const errorText = (error: unknown) => error instanceof Error ? error.message : '操作没有完成，请重试。';
