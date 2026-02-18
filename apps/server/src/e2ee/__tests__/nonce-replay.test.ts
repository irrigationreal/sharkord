import { describe, expect, test } from 'bun:test';
import { validateAndStoreReplayCounter, reserveNonceCounterBlock } from '../nonce-replay';

describe('nonce allocator', () => {
  test('should reserve sequential counter blocks without reuse', async () => {
    const first = await reserveNonceCounterBlock('sender-key-1');
    const second = await reserveNonceCounterBlock('sender-key-1');

    expect(first.startCounter).toBe(0);
    expect(first.endCounter).toBe(1023);
    expect(second.startCounter).toBe(1024);
    expect(second.endCounter).toBe(2047);
    expect(second.noncePrefix).toBe(first.noncePrefix);
  });
});

describe('replay window', () => {
  test('should accept new counters and reject duplicates', async () => {
    const first = await validateAndStoreReplayCounter({
      channelId: 1,
      senderDeviceId: 'device-a',
      senderKeyId: 'sender-key-a',
      counter: 1
    });
    const second = await validateAndStoreReplayCounter({
      channelId: 1,
      senderDeviceId: 'device-a',
      senderKeyId: 'sender-key-a',
      counter: 2
    });
    const duplicate = await validateAndStoreReplayCounter({
      channelId: 1,
      senderDeviceId: 'device-a',
      senderKeyId: 'sender-key-a',
      counter: 2
    });

    expect(first).toEqual({ accepted: true, reason: 'ok' });
    expect(second).toEqual({ accepted: true, reason: 'ok' });
    expect(duplicate).toEqual({ accepted: false, reason: 'duplicate' });
  });

  test('should reject counter gaps beyond max', async () => {
    await validateAndStoreReplayCounter({
      channelId: 1,
      senderDeviceId: 'device-b',
      senderKeyId: 'sender-key-b',
      counter: 1
    });

    const tooFar = await validateAndStoreReplayCounter({
      channelId: 1,
      senderDeviceId: 'device-b',
      senderKeyId: 'sender-key-b',
      counter: 10002
    });

    expect(tooFar).toEqual({ accepted: false, reason: 'counter_gap_exceeded' });
  });
});
