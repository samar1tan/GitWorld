# Local application service

`@gitworld/service` connects the canonical domain model, SQLite repository and
review-only source ingestion. It exposes the typed request/response protocol from
`@gitworld/contracts`; it does not expose a network listener or a shell.

```ts
const service = await createLocalService({
  dataDirectory,
  seedPackagePath,
  resolveFileToken: (token, purpose) => hostGrants.resolve(token, purpose),
  onProgress: progress => sendProgress(progress),
});
const response = await service.dispatch(request);
await service.close();
```

These options are trusted host inputs. The renderer sends opaque, purpose-bound
file tokens, not filesystem paths. The desktop host must also validate the IPC
sender and frame, restrict navigation, and bound messages before dispatch.

The first empty library imports and publishes the bundled reviewed seed through
the ordinary validation and publication path. A library containing drafts or
published datasets is never reseeded. Legacy model queries use validated
packages, while Knowledge queries read the selected Git revision or a guarded
Working snapshot. New libraries import the pinned Knowledge bundle through the
same content path; an existing library is not silently upgraded to a newer
bundle. There is no fixture fallback. A missing, damaged or unsupported library
returns a structured error. `backup.restore` remains available when library
initialization fails.

GUI intents and terminal commands use the same domain executor. Query results
contain explicit effects; queries do not directly persist a workspace or move
HEAD. The renderer applies an effect and saves the revision-qualified workspace
with its expected version. Query engines are cached by dataset and revision and
discarded after restore.

Mutation requests are serialized. While a source acquisition is admitted, new
mutation requests fail immediately with `OPERATION_IN_PROGRESS`, rather than
waiting behind network work and executing after a client timeout. Queries and
cancellation remain available; cancellation takes effect even before the queued
acquisition reaches the network. Publication and restore have durable operation
receipts; imports store their preview and receipt in one transaction. A retry must
reuse the original operation ID and parameters. File token resolution occurs
after durable retry lookup, allowing a completed request to be retried after its
token expires. Export and backup artifacts are atomic file replacements, but a
crash before their operation receipt may cause the same artifact to be written
again on retry; they do not alter historical records.

The legacy package acquisition route uses the fixed `met-open-access-v1` adapter
with bounded numeric object IDs. The Wikipedia routes separately persist bounded
source jobs, inspect stored tables, prepare explicit mapping previews and adopt
reviewed selections into Working content. `source.search` and `source.collect`
connect Wikidata lookup and acquisition to the Sources workbench. These flows
retain raw evidence locally; a
source configuration cannot supply executable code or an arbitrary endpoint.
Acquisition does not approve rights or publish content. See the
[source-binding contract](../../docs/source-bindings-prd.md) for the prepared
preview, adoption and recovery boundaries.
Progress is structured, and `operation.cancel` aborts an active acquisition.
Call `close()` directly during shutdown: it aborts acquisitions, drains requests
and then closes SQLite. Waiting for acquisitions before calling it would defer
that cancellation.

The service tests cover offline seeding, runtime data import, GUI/CLI equivalence,
purpose-bound files, draft deletion, restore retry semantics across restart and
recovery of an unavailable library. The Electron smoke test separately verifies
the actual embedded Node/SQLite runtime and packaged seed path.
