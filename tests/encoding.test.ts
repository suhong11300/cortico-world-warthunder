import { describe, it, expect } from 'vitest';
import { BattleClient, decodeGameText } from '../src/battle.ts';

/** 真机抓下来的 GBK 字节:中文客户端的 /gamechat 与 /hudmsg 就是这个样子。 */
const CHAT_GBK = [123,34,105,100,34,58,55,44,34,115,101,110,100,101,114,34,58,34,205,230,188,210,188,215,34,44,34,109,115,103,34,58,34,187,247,187,217,193,203,32,84,45,51,52,34,44,34,101,110,101,109,121,34,58,102,97,108,115,101,44,34,109,111,100,101,34,58,34,65,108,108,34,125];
const HUD_GBK = [123,34,101,118,101,110,116,115,34,58,91,93,44,34,100,97,109,97,103,101,34,58,91,123,34,105,100,34,58,57,44,34,116,105,109,101,34,58,49,50,46,53,44,34,116,121,112,101,34,58,34,100,97,109,97,103,101,34,44,34,109,115,103,34,58,34,205,230,188,210,210,210,32,210,253,200,188,193,203,32,205,230,188,210,177,251,34,44,34,115,101,110,100,101,114,34,58,34,205,230,188,210,210,210,34,125,93,125];
/** /gamechat 的响应是数组,单条对象会被当成空结果。 */
const CHAT_ARRAY_GBK = [91].concat(CHAT_GBK, [93]);
const CHAT_TEXT = '{"id":7,"sender":"玩家甲","msg":"击毁了 T-34","enemy":false,"mode":"All"}';

/** 一个只有字节流、没有 headers 的假响应:走 arrayBuffer 分支。 */
function byteResponse(list: number[]) {
  const buf = new Uint8Array(list);
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer as ArrayBuffer };
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('8111 文本解码', () => {
  it('auto:GBK 字节解出正确中文', () => {
    const text = decodeGameText(new Uint8Array(CHAT_GBK), '');
    expect(text).toBe(CHAT_TEXT);
    const parsed = JSON.parse(text) as { sender: string; msg: string };
    expect(parsed.sender).toBe('玩家甲');
    expect(parsed.msg).toBe('击毁了 T-34');
  });

  it('auto:UTF-8 字节原样保留,不会被误判成 GBK', () => {
    const text = decodeGameText(utf8Bytes('{"msg":"击毁了 T-34"}'), '');
    expect(text).toBe('{"msg":"击毁了 T-34"}');
    expect(text.includes('\ufffd')).toBe(false);
  });

  it('Content-Type 写了 charset=gbk 就照它解', () => {
    const text = decodeGameText(new Uint8Array(CHAT_GBK), 'application/json; charset=gbk');
    expect(text).toBe(CHAT_TEXT);
  });

  it('剥掉 UTF-8 BOM,否则 JSON.parse 会失败', () => {
    const raw = utf8Bytes('{"valid":true}');
    const withBom = new Uint8Array(raw.length + 3);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(raw, 3);
    const text = decodeGameText(withBom, '');
    expect(text).toBe('{"valid":true}');
    expect(text.startsWith('\ufeff')).toBe(false);
  });

  it('钉死 utf-8 去解 GBK 会得到替换字符,说明猜错档位是有代价的', () => {
    const text = decodeGameText(new Uint8Array(CHAT_GBK), '', 'utf-8');
    expect(text.includes('\ufffd')).toBe(true);
  });

  it('空字节流给空串', () => {
    expect(decodeGameText(new Uint8Array([]), '')).toBe('');
  });
});

describe('8111 客户端的解码与净化', () => {
  it('/gamechat 的 GBK 响应解出中文发送者与正文', async () => {
    const fetchImpl = (async () => byteResponse(CHAT_ARRAY_GBK)) as unknown as typeof globalThis.fetch;
    const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl });
    const lines = await client.gamechat(-1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.sender).toBe('玩家甲');
    expect(lines[0]?.msg).toBe('击毁了 T-34');
    expect(lines[0]?.mode).toBe('All');
  });

  it('/hudmsg 的 GBK 伤害播报解出中文,并且去掉零宽与控制字符', async () => {
    const fetchImpl = (async () => byteResponse(HUD_GBK)) as unknown as typeof globalThis.fetch;
    const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl });
    const hud = await client.hud(-1, -1);
    expect(hud.damage).toHaveLength(1);
    expect(hud.damage[0]?.sender).toBe('玩家乙');
    expect(hud.damage[0]?.msg).toBe('玩家乙 引燃了 玩家丙');
  });

  it('UTF-8 客户端里带零宽空格的玩家名会被清干净', async () => {
    const body = '[{"id":3,"sender":"玩\u200b家\ufeff甲","msg":"gg  wp","enemy":false,"mode":"All"}]';
    const buf = new TextEncoder().encode(body);
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => buf.buffer as ArrayBuffer,
    })) as unknown as typeof globalThis.fetch;
    const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl });
    const lines = await client.gamechat(-1);
    expect(lines[0]?.sender).toBe('玩家甲');
    expect(lines[0]?.msg).toBe('gg wp');
  });

  it('只有 text() 没有 arrayBuffer() 的实现仍然能用', async () => {
    const fetchImpl = (async () => ({ ok: true, status: 200, text: async () => '[' + CHAT_TEXT + ']' })) as unknown as typeof globalThis.fetch;
    const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl });
    const lines = await client.gamechat(-1);
    expect(lines[0]?.sender).toBe('玩家甲');
  });
});
