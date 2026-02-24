import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

// Cleanup DOM after each test when using @testing-library/svelte
afterEach(() => cleanup());
