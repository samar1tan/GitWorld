# Local service contract

`@gitworld/contracts` defines the renderer/service boundary and the storage adapter interface. It imports the historical model from `@gitworld/domain` rather than duplicating graph types.

`ServiceRequest` contains `protocolVersion: 1`, `requestId`, `method`, and method-specific `params`. `ServiceResponse` echoes the protocol and request ID and contains either a typed result or structured error. `validateServiceRequest` rejects unsupported methods, malformed payloads, raw file paths, and extra envelope/parameter keys. The host must additionally validate the IPC sender and origin.

`LocalService.dispatch(request)` is the application-service boundary. `DesktopBridge` exposes request, progress, native file selection, and external citation opening. A native file selection returns an opaque file token; the service resolves it through a trusted host callback with an explicit purpose. Tokens are capabilities with an application-controlled lifetime, not filesystem paths supplied by the renderer.

`DesktopBridge.onBeforeClose(prepare, cancelled)` registers an asynchronous close
barrier. Preparation drains queued workspace saves before returning `ready: true`.
A false result distinguishes `save-failed` from `unsaved-input`; the latter does
not authorize saving or discarding unsubmitted form values. The native host keeps
the window open unless saving succeeds or the user explicitly discards those
inputs. Cancellation restores editing and invalidates late acknowledgements.
Correlation IDs and trusted-frame checks belong to the host/preload channel and
are not exposed as renderer-controlled IPC arguments. The host closes the service
only after the renderer barrier succeeds; the service then drains accepted
requests before closing SQLite.

`HistoryRepository` is implemented by SQLite infrastructure. Publication is atomic and retry-safe through `operationId`. Draft and workspace saves use optimistic concurrency; `expectedVersion: null` creates a previously absent workspace. An existing row requires its exact stored version. Successful saves return the authoritative incremented version.

`WorkspaceState` pins `{ datasetId, revisionId }`, and HEAD and comparison endpoints repeat that pair with exact commit IDs. `validateWorkspace(state, package)` checks both the shape and actual refs/date resolutions. It rejects silently migrated or stale refs. Requests querying an old published revision remain on that revision even after a newer release is activated.

The full `ServiceMethods` map in `src/index.ts` is the API inventory. Query failures and validation failures preserve workspace state. Browser navigation and transient terminal drafts remain presentation concerns; the service persists semantic workspace state, not the rendered terminal transcript.
