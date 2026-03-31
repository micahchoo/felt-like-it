import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AnnotationList from '$lib/components/annotations/AnnotationList.svelte';

describe('AnnotationList', () => {
  const mockAnnotations = [
    {
      id: 'a1',
      map_id: 'map-1',
      authorId: 'user-1',
      authorName: 'Alice',
      content: {
        kind: 'single' as const,
        body: { type: 'text' as const, text: 'First annotation' },
      },
      anchor: { type: 'point' as const, coordinates: [0, 0] as [number, number] },
      resolved: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      version: 0,
    },
    {
      id: 'a2',
      map_id: 'map-1',
      authorId: 'user-1',
      authorName: 'Bob',
      content: {
        kind: 'single' as const,
        body: { type: 'text' as const, text: 'Second annotation' },
      },
      anchor: { type: 'point' as const, coordinates: [1, 1] as [number, number] },
      resolved: false,
      created_at: '2024-01-02',
      updated_at: '2024-01-02',
      version: 0,
    },
  ];

  const defaultProps = {
    annotations: mockAnnotations,
    comments: [],
    userId: 'user-1',
    expandedAnnotationId: null as string | null,
    replyingTo: null as string | null,
    replyText: '',
    listLoading: false,
    listError: null as string | null,
    onexpand: vi.fn(),
    onreplying: vi.fn(),
    onreplytext: vi.fn(),
    onreply: vi.fn(),
    ondelete: vi.fn(),
    onconverttopoint: vi.fn(),
    onfetchnavplace: vi.fn(),
  };

  it('renders empty state when no annotations or comments', () => {
    render(AnnotationList, {
      ...defaultProps,
      annotations: [],
      comments: [],
    });
    expect(screen.getByText(/No annotations yet/i)).toBeDefined();
  });

  it('renders loading state', () => {
    render(AnnotationList, {
      ...defaultProps,
      listLoading: true,
    });
    expect(screen.getByText(/Loading/i)).toBeDefined();
  });

  it('renders error state', () => {
    render(AnnotationList, {
      ...defaultProps,
      listError: 'Something went wrong',
    });
    expect(screen.getByText(/Something went wrong/i)).toBeDefined();
  });

  it('renders list of annotations with text content', () => {
    render(AnnotationList, defaultProps);
    expect(screen.getByText('First annotation')).toBeDefined();
    expect(screen.getByText('Second annotation')).toBeDefined();
  });

  it('shows Replies button for each annotation', () => {
    render(AnnotationList, defaultProps);
    const replyButtons = screen.getAllByText('Replies');
    expect(replyButtons.length).toBe(2);
  });

  it('shows Delete button for own annotations', () => {
    render(AnnotationList, defaultProps);
    const deleteButtons = screen.getAllByText('Delete');
    expect(deleteButtons.length).toBe(2);
  });

  it('calls ondelete when Delete clicked', async () => {
    const ondelete = vi.fn();
    render(AnnotationList, {
      ...defaultProps,
      ondelete,
    });
    const deleteButtons = screen.getAllByText('Delete');
    await deleteButtons[0].click();
    expect(ondelete).toHaveBeenCalledWith('a1');
  });

  it('calls onexpand when Replies clicked', async () => {
    const onexpand = vi.fn();
    render(AnnotationList, {
      ...defaultProps,
      onexpand,
    });
    const replyButtons = screen.getAllByText('Replies');
    await replyButtons[0].click();
    expect(onexpand).toHaveBeenCalledWith('a1');
  });

  it('shows Reply button and form when replyingTo is set', () => {
    render(AnnotationList, {
      ...defaultProps,
      replyingTo: 'a1',
    });
    // Reply button appears for each annotation (userId matches authorId)
    const replyButtons = screen.getAllByText('Reply');
    expect(replyButtons.length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('Write a reply...')).toBeDefined();
    expect(screen.getByText('Send')).toBeDefined();
  });

  it('shows viewport badge for viewport-anchored annotations', () => {
    const viewportAnnotation = {
      ...mockAnnotations[0],
      anchor: { type: 'viewport' as const },
    };
    render(AnnotationList, {
      ...defaultProps,
      annotations: [viewportAnnotation],
    });
    expect(screen.getByText('Map-level')).toBeDefined();
  });

  it('shows region badge for region-anchored annotations', () => {
    const regionAnnotation = {
      ...mockAnnotations[0],
      anchor: {
        type: 'region' as const,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
    };
    render(AnnotationList, {
      ...defaultProps,
      annotations: [regionAnnotation],
    });
    expect(screen.getByText('Region')).toBeDefined();
  });
});
