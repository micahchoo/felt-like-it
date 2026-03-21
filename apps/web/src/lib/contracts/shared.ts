export interface BaseActions {
	onRetry: () => Promise<void>;
}

export interface PaginatedData<T> {
	items: T[];
	totalCount: number;
	nextCursor: string | null;
}
