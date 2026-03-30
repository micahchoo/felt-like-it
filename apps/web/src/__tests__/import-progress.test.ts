// @vitest-environment node
/**
 * SSE progress endpoint for import jobs.
 * Tests the GET /api/import/progress endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing the endpoint
vi.mock('$lib/server/db/index.js', () => ({
  db: {
    execute: vi.fn(),
  },
  importJobs: { id: 'import_jobs' },
}));

describe('GET /api/import/progress', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 400 when jobId is missing', async () => {
    const { GET } = await import('$lib/../routes/api/import/progress/+server.js');
    const request = new Request('http://localhost/api/import/progress');
    const url = new URL(request.url);
    await expect(GET({ request, url } as any)).rejects.toThrow();
  });

  it('returns SSE stream with correct headers', async () => {
    const { db } = await import('$lib/server/db/index.js');
    vi.mocked(db.execute).mockResolvedValue({
      rows: [{ status: 'processing', progress: 45, error_message: null }],
    } as any);

    const { GET } = await import('$lib/../routes/api/import/progress/+server.js');
    const request = new Request('http://localhost/api/import/progress?jobId=test-123');
    const url = new URL(request.url);
    const response = await GET({ request, url } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('sends error event when job not found', async () => {
    const { db } = await import('$lib/server/db/index.js');
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as any);

    const { GET } = await import('$lib/../routes/api/import/progress/+server.js');
    const request = new Request('http://localhost/api/import/progress?jobId=nonexistent');
    const url = new URL(request.url);
    const response = await GET({ request, url } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    // Read the stream to verify error event
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain('data:');
    expect(text).toContain('error');
    expect(text).toContain('Job not found');
  });

  it('sends progress event for processing job', async () => {
    const { db } = await import('$lib/server/db/index.js');
    vi.mocked(db.execute).mockResolvedValue({
      rows: [{ status: 'processing', progress: 45, error_message: null }],
    } as any);

    const { GET } = await import('$lib/../routes/api/import/progress/+server.js');
    const request = new Request('http://localhost/api/import/progress?jobId=test-123');
    const url = new URL(request.url);
    const response = await GET({ request, url } as any);

    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain('data:');
    expect(text).toContain('"progress"');
    expect(text).toContain('45');
  });

  it('sends complete event for done job and closes stream', async () => {
    const { db } = await import('$lib/server/db/index.js');
    vi.mocked(db.execute).mockResolvedValue({
      rows: [{ status: 'done', progress: 100, error_message: null, layer_id: 'layer-abc' }],
    } as any);

    const { GET } = await import('$lib/../routes/api/import/progress/+server.js');
    const request = new Request('http://localhost/api/import/progress?jobId=test-123');
    const url = new URL(request.url);
    const response = await GET({ request, url } as any);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Read all chunks until stream closes
    let allText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      allText += decoder.decode(value);
    }

    expect(allText).toContain('"complete"');
    expect(allText).toContain('100');
    expect(allText).toContain('layer-abc');
  });

  it('sends error event for failed job with error message', async () => {
    const { db } = await import('$lib/server/db/index.js');
    vi.mocked(db.execute).mockResolvedValue({
      rows: [{ status: 'failed', progress: 30, error_message: 'Parse error: invalid GeoJSON' }],
    } as any);

    const { GET } = await import('$lib/../routes/api/import/progress/+server.js');
    const request = new Request('http://localhost/api/import/progress?jobId=test-123');
    const url = new URL(request.url);
    const response = await GET({ request, url } as any);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain('"error"');
    expect(text).toContain('Parse error: invalid GeoJSON');
  });
});
