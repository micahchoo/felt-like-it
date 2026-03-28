# Cross-Cutting Security Assessment

## Critical

None — initially flagged findings were **disproved by deep drill**:
- `hooks.server.ts` checks `disabledAt` upstream, invalidates session, sets `locals.user = null`
- `admin.toggleDisabled` calls `lucia.invalidateUserSessions(userId)` on disable
- All REST v1 handlers call `resolveAuth()` — 100% coverage verified

## High

| Finding | Subsystem | Impact |
|---------|-----------|--------|
| CI has no test/lint/security gate | Infrastructure | Tests exist (73 files) but are not enforced. Regressions ship silently. |
| Default admin password 'admin' in seed | Infrastructure | No forced change on first login. |
| Worker has no tests | Data Pipeline | Raw SQL bulk insert bypasses ORM validation. |
| Import file cleanup missing | Data Pipeline | Files persist in UPLOAD_DIR indefinitely → disk exhaustion. |

## Medium

| Finding | Subsystem | Impact |
|---------|-----------|--------|
| Rate limiter in-memory only | Auth/API | Resets on restart, doesn't work multi-process. tRPC has zero rate limiting. |
| REST v1 per-handler auth pattern | API | Missing `resolveAuth()` call = unauthenticated endpoint. |
| API key scope: no DB constraint | API | Text column accepts invalid values. |
| geomColName unvalidated in GeoPackage | Data Pipeline | User-controlled column name from .gpkg file. |
| Feature properties stored raw | Data Pipeline | XSS if frontend renders as HTML. |
| XML parsing: XXE not explicitly blocked | Data Pipeline | @xmldom/xmldom defaults safe but no explicit config. |
| Worker duplicates all format parsers | Data Pipeline | Bug fix in one location doesn't fix the other. |
| SESSION_SECRET has dev default | Infrastructure | `'change-me-in-production...'` in docker-compose.yml. |
| Martin pinned to :latest | Infrastructure | Silent breaking changes on redeploy. |

## Low

| Finding | Subsystem | Impact |
|---------|-----------|--------|
| No per-map API key scoping | API | Leaked key exposes all user's maps. |
| Audit lock bottleneck (key=1) | Auth | All audit writes serialize globally. |
| Docker socket mounted to Traefik | Infrastructure | Privilege escalation vector (read-only mitigates). |
