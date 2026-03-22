<script lang="ts">
  const BASE = '/api/v1';
  const endpoints = [
    { method: 'GET', path: '/maps', desc: 'List maps accessible to this key', auth: 'API key, Share token (single map)' },
    { method: 'GET', path: '/maps/:mapId', desc: 'Map detail with viewport', auth: 'API key, Share token' },
    { method: 'GET', path: '/maps/:mapId/layers', desc: 'List layers on a map', auth: 'API key, Share token' },
    { method: 'GET', path: '/maps/:mapId/layers/:layerId', desc: 'Layer detail with style', auth: 'API key, Share token' },
    { method: 'GET', path: '/maps/:mapId/layers/:layerId/geojson', desc: 'GeoJSON FeatureCollection (bare, no envelope)', auth: 'API key, Share token' },
    { method: 'GET', path: '/maps/:mapId/layers/:layerId/features', desc: 'Paginated feature rows (no geometry)', auth: 'API key, Share token' },
    { method: 'GET', path: '/maps/:mapId/layers/:layerId/tiles', desc: 'Martin tile URL and bounds', auth: 'API key, Share token' },
    { method: 'GET', path: '/maps/:mapId/annotations', desc: 'List annotations', auth: 'API key, Share token' },
    { method: 'GET', path: '/maps/:mapId/annotations/:id', desc: 'Single annotation', auth: 'API key, Share token' },
    { method: 'POST', path: '/maps/:mapId/annotations', desc: 'Create annotation', auth: 'API key (read-write)' },
    { method: 'PATCH', path: '/maps/:mapId/annotations/:id', desc: 'Update annotation', auth: 'API key (read-write)' },
    { method: 'DELETE', path: '/maps/:mapId/annotations/:id', desc: 'Delete annotation', auth: 'API key (read-write)' },
    { method: 'GET', path: '/maps/:mapId/comments', desc: 'List comments', auth: 'API key, Share token' },
    { method: 'GET', path: '/maps/:mapId/comments/:id', desc: 'Single comment', auth: 'API key, Share token' },
    { method: 'POST', path: '/maps/:mapId/comments', desc: 'Create comment', auth: 'API key (read-write)' },
    { method: 'POST', path: '/files', desc: 'Upload file (multipart/form-data)', auth: 'API key (read-write)' },
    { method: 'GET', path: '/files/:id', desc: 'Download file', auth: 'API key, Share token' },
  ];

  const errorCodes = [
    { code: 'UNAUTHORIZED', status: 401, when: 'No valid API key or share token' },
    { code: 'FORBIDDEN', status: 403, when: 'Valid auth but insufficient scope' },
    { code: 'MAP_NOT_FOUND', status: 404, when: 'Map does not exist or not accessible' },
    { code: 'LAYER_NOT_FOUND', status: 404, when: 'Layer does not exist on this map' },
    { code: 'ANNOTATION_NOT_FOUND', status: 404, when: 'Annotation does not exist' },
    { code: 'COMMENT_NOT_FOUND', status: 404, when: 'Comment does not exist' },
    { code: 'VALIDATION_ERROR', status: 422, when: 'Request body fails validation' },
    { code: 'LIMIT_EXCEEDED', status: 422, when: 'Per-map annotation limit reached' },
    { code: 'VERSION_CONFLICT', status: 409, when: 'If-Match version mismatch' },
    { code: 'RATE_LIMITED', status: 429, when: 'Too many requests' },
  ];

  function methodColor(m: string) {
    if (m === 'GET') return '#22c55e';
    if (m === 'POST') return '#3b82f6';
    if (m === 'PATCH') return '#f59e0b';
    if (m === 'DELETE') return '#ef4444';
    return '#888';
  }
</script>

<svelte:head>
  <title>FLI REST API v1</title>
</svelte:head>

<div class="docs">
  <header>
    <h1>FLI REST API v1</h1>
    <p class="subtitle">Spatial data, annotations, and comments for external apps</p>
  </header>

  <section>
    <h2>Authentication</h2>
    <div class="auth-methods">
      <div class="auth-card">
        <h3>API Key</h3>
        <code class="example">Authorization: Bearer flk_&lt;64hex&gt;</code>
        <p>Resolves to a FLI user. Inherits that user's map access. Scope: <code>read</code> or <code>read-write</code>.</p>
        <p>Rate limit: <strong>100 req/s</strong> (configurable)</p>
      </div>
      <div class="auth-card">
        <h3>Share Token</h3>
        <code class="example">GET /api/v1/maps/:mapId/layers?token=&lt;token&gt;</code>
        <p>Anonymous read-only access to a single map. No writes. No API key required.</p>
        <p>Rate limit: <strong>30 req/s</strong></p>
      </div>
    </div>
  </section>

  <section>
    <h2>Response Envelope</h2>
    <p>All responses (except GeoJSON) use this shape:</p>
    <pre class="code-block">{`{
  "data": { ... },
  "meta": { "totalCount": 42, "limit": 20, "nextCursor": "..." },
  "links": { "self": "...", "next": "...?cursor=..." }
}`}</pre>
    <p>GeoJSON endpoints return bare <code>application/geo+json</code> with no envelope.</p>
  </section>

  <section>
    <h2>Pagination</h2>
    <p>Cursor-based on all list endpoints. Query params:</p>
    <ul>
      <li><code>?cursor=&lt;opaque&gt;</code> — resume from this position</li>
      <li><code>?limit=20</code> — items per page (max 100, default 20)</li>
    </ul>
    <p>Cursors are opaque strings. Use the <code>links.next</code> URL to fetch the next page.</p>
  </section>

  <section>
    <h2>Endpoints</h2>
    <p>Base URL: <code>{BASE}</code></p>
    <div class="endpoint-list">
      {#each endpoints as ep (ep.method + ep.path)}
        <div class="endpoint">
          <span class="method" style="background: {methodColor(ep.method)}">{ep.method}</span>
          <code class="path">{BASE}{ep.path}</code>
          <span class="desc">{ep.desc}</span>
          <span class="auth-badge">{ep.auth}</span>
        </div>
      {/each}
    </div>
  </section>

  <section>
    <h2>GeoJSON Filters</h2>
    <p><code>GET /api/v1/maps/:mapId/layers/:layerId/geojson</code> supports:</p>
    <ul>
      <li><code>?bbox=-122.5,37.7,-122.3,37.8</code> — spatial bounding box filter</li>
      <li><code>?limit=5000</code> — max features (default 50,000)</li>
    </ul>
    <p>Response is directly consumable by MapLibre: <code>map.addSource('data', {'{ type: "geojson", data: response }'})</code></p>
  </section>

  <section>
    <h2>Annotations</h2>
    <h3>Create</h3>
    <pre class="code-block">{`POST /api/v1/maps/:mapId/annotations
Content-Type: application/json

{
  "anchor": { "type": "point", "geometry": { "type": "Point", "coordinates": [-122.4, 37.7] } },
  "content": { "kind": "single", "body": { "type": "text", "text": "Notable area" } },
  "parentId": null
}`}</pre>

    <h3>Update (with optimistic concurrency)</h3>
    <pre class="code-block">{`PATCH /api/v1/maps/:mapId/annotations/:id
If-Match: 3
Content-Type: application/json

{
  "content": { "kind": "single", "body": { "type": "text", "text": "Updated note" } }
}`}</pre>
    <p>If <code>If-Match</code> is present and the version doesn't match, returns <code>409 VERSION_CONFLICT</code>. If absent, last-write-wins.</p>

    <h3>Delete</h3>
    <p><code>DELETE /api/v1/maps/:mapId/annotations/:id</code> returns <code>204 No Content</code>.</p>
  </section>

  <section>
    <h2>Comments</h2>
    <pre class="code-block">{`POST /api/v1/maps/:mapId/comments
Content-Type: application/json

{ "body": "This layer needs attribution" }`}</pre>
  </section>

  <section>
    <h2>File Upload</h2>
    <pre class="code-block">{`POST /api/v1/files
Content-Type: multipart/form-data

file: <binary>   (max 50MB)`}</pre>
    <p>Returns <code>{'{ "data": { "id": "uuid", "fileName": "...", "fileSize": 1234, "url": "/api/v1/files/uuid" } }'}</code></p>
  </section>

  <section>
    <h2>Error Codes</h2>
    <p>Consumers should switch on <code>error.code</code>, not HTTP status. Codes are stable across versions.</p>
    <pre class="code-block">{`{
  "error": {
    "code": "MAP_NOT_FOUND",
    "message": "Map with id '...' not found",
    "status": 404
  }
}`}</pre>
    <div class="error-table">
      <div class="error-header">
        <span>Code</span><span>Status</span><span>When</span>
      </div>
      {#each errorCodes as err (err.code)}
        <div class="error-row">
          <code>{err.code}</code>
          <span class="status">{err.status}</span>
          <span>{err.when}</span>
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .docs {
    max-width: 52rem;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    color: #1a1a2e;
    line-height: 1.6;
  }
  header { margin-bottom: 2.5rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 1.5rem; }
  h1 { font-size: 2rem; font-weight: 700; margin: 0; }
  .subtitle { color: #64748b; margin: 0.25rem 0 0; font-size: 1.1rem; }
  h2 { font-size: 1.35rem; font-weight: 600; margin: 2rem 0 0.75rem; color: #0f172a; }
  h3 { font-size: 1.05rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }
  section { margin-bottom: 1rem; }
  code { background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.88em; }
  .code-block {
    background: #0f172a; color: #e2e8f0; padding: 1rem 1.25rem; border-radius: 8px;
    overflow-x: auto; font-size: 0.85rem; line-height: 1.5; margin: 0.75rem 0;
  }
  .auth-methods { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.75rem; }
  .auth-card {
    border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem 1.25rem;
    background: #fafbfc;
  }
  .auth-card h3 { margin: 0 0 0.5rem; font-size: 1rem; }
  .auth-card p { margin: 0.4rem 0; font-size: 0.9rem; color: #475569; }
  .example { display: block; margin: 0.5rem 0; font-size: 0.82rem; background: #0f172a; color: #93c5fd; padding: 0.5rem 0.75rem; border-radius: 6px; }
  .endpoint-list { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.75rem; }
  .endpoint {
    display: grid; grid-template-columns: 4.5rem 1fr auto; gap: 0.5rem;
    align-items: center; padding: 0.5rem 0.75rem; border-radius: 6px;
    font-size: 0.88rem; border: 1px solid #e2e8f0;
  }
  .endpoint:hover { background: #f8fafc; }
  .method {
    color: white; font-weight: 700; font-size: 0.75rem; padding: 0.2rem 0.5rem;
    border-radius: 4px; text-align: center; font-family: monospace;
  }
  .path { font-size: 0.82rem; background: none; padding: 0; }
  .desc { color: #64748b; font-size: 0.82rem; grid-column: 2; }
  .auth-badge { font-size: 0.72rem; color: #94a3b8; grid-column: 3; grid-row: 1 / 3; text-align: right; }
  .error-table { margin-top: 0.75rem; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  .error-header, .error-row {
    display: grid; grid-template-columns: 12rem 4rem 1fr; gap: 0.75rem;
    padding: 0.5rem 1rem; font-size: 0.85rem;
  }
  .error-header { background: #f1f5f9; font-weight: 600; font-size: 0.8rem; color: #475569; }
  .error-row { border-top: 1px solid #e2e8f0; }
  .error-row:hover { background: #fafbfc; }
  .status { color: #64748b; }
  ul { padding-left: 1.5rem; }
  li { margin: 0.25rem 0; font-size: 0.92rem; }
  @media (max-width: 640px) {
    .auth-methods { grid-template-columns: 1fr; }
    .endpoint { grid-template-columns: 4rem 1fr; }
    .auth-badge { display: none; }
    .error-header, .error-row { grid-template-columns: 10rem 3rem 1fr; }
  }
</style>
