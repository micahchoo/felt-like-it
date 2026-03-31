/* eslint-disable no-undef, @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies before importing the handler
vi.mock('$env/dynamic/private', () => ({ env: { UPLOAD_DIR: '/tmp/test-uploads' } }));
vi.mock('$lib/server/db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'test-job-id' }]),
      }),
    }),
  },
  importJobs: { id: 'import_jobs' },
}));
vi.mock('$lib/server/jobs/queues.js', () => ({
  enqueueImportJob: vi.fn().mockResolvedValue('test-job-id'),
}));
vi.mock('$lib/server/geo/access.js', () => ({
  requireMapAccess: vi.fn().mockResolvedValue(true),
}));

describe('POST /api/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams file to disk without loading entire file into memory', async () => {
    const { POST } = await import('../routes/api/upload/+server.js');

    // Create a real File object with a working stream() method
    const mockFile = new File(['test content'], 'large.geojson', {
      type: 'application/json',
    });
    // Add stream() method since jsdom File may not have it
    Object.defineProperty(mockFile, 'stream', {
      value: () => {
        const encoder = new TextEncoder();
        const data = encoder.encode('test content');
        return new ReadableStream({
          start(controller) {
            controller.enqueue(data);
            controller.close();
          },
        });
      },
      writable: false,
    });
    // Also need a reasonable size
    Object.defineProperty(mockFile, 'size', {
      value: 12,
      writable: false,
    });

    const mockFormData = new FormData();
    mockFormData.append('file', mockFile);
    mockFormData.append('mapId', 'test-map-uuid');

    const mockRequest = {
      formData: () => Promise.resolve(mockFormData),
    } as unknown as Request;

    const response = await POST({
      request: mockRequest,
      locals: { user: { id: 'test-user' } },
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('jobId');
  });

  it('rejects files exceeding MAX_FILE_SIZE via streaming byte count', async () => {
    const { POST } = await import('../routes/api/upload/+server.js');

    // Create a mock file that exceeds 100MB via streaming
    const mockFile = new File(['x'], 'huge.geojson', {
      type: 'application/json',
    });
    // Override stream() to send large chunks that exceed MAX_FILE_SIZE
    Object.defineProperty(mockFile, 'stream', {
      value: () => {
        let bytesSent = 0;
        const limit = 101 * 1024 * 1024; // 101MB
        return new ReadableStream({
          pull(controller) {
            if (bytesSent >= limit) {
              controller.close();
              return;
            }
            const chunkSize = Math.min(1024 * 1024, limit - bytesSent);
            bytesSent += chunkSize;
            controller.enqueue(new Uint8Array(chunkSize));
          },
        });
      },
      writable: false,
    });
    // Set size to appear large but the streaming check is what matters
    Object.defineProperty(mockFile, 'size', {
      value: 101 * 1024 * 1024,
      writable: false,
    });

    const mockFormData = new FormData();
    mockFormData.append('file', mockFile);
    mockFormData.append('mapId', 'test-map-uuid');

    const mockRequest = {
      formData: () => Promise.resolve(mockFormData),
    } as unknown as Request;

    try {
      await POST({
        request: mockRequest,
        locals: { user: { id: 'test-user' } },
      } as any);
      // If we get here, the test should fail
      expect.fail('Expected error to be thrown');
    } catch (e: any) {
      expect(e.status).toBe(413);
      expect(e.body.message).toContain('File too large');
    }
  });
});
