# Document storage backends — S3-compatible options for Docurama

Docurama stores uploaded signing documents through `src/lib/document-store.ts`.
Today that layer writes to the local filesystem (`STORAGE_DIR`), which is
correct for a single-node deployment and for development. When the platform
scales past one API replica — or when operators ask for independent, cheaper
scaling of blob storage — the natural upgrade path is an S3-compatible object
store. This note compares the three self-hostable candidates we would consider
first, with the trade-offs that matter for an EU-hosted e-signature platform.

## What the storage layer needs

- Write-once document blobs (PDFs and uploads), read for signer portals and
  evidence-pack exports, deleted with retention policies.
- Content-addressed keys work well (the platform already computes SHA-256 for
  every envelope), so any S3-compatible API is sufficient.
- EU data residency: the cluster runs in EU datacenters, full stop.
- Honest durability: replication/erasure coding across disks, bitrot checks.

## Candidates

### MinIO

- **What it is:** the most widely deployed self-hosted S3-compatible server;
  single Go binary, Kubernetes-native, feature-dense (versioning, object
  locking, KMS integration, console UI).
- **Strengths:** largest ecosystem, best-documented, object locking supports
  legal-hold-style retention, mature IAM policies, web console out of the box.
- **Trade-offs:** the AGPL license requires care in how it is embedded in a
  commercial offering (kept as a separate service, not linked, it is workable —
  but the legal review is real). Resource-hungry for small installations.
  The enterprise-focused feature velocity means the community edition's
  long-term trajectory needs watching.
- **Fit:** best when the operator wants a batteries-included, console-managed
  storage service and has someone to own the AGPL conversation.

### SeaweedFS

- **What it is:** a fast distributed file system inspired by Facebook's
  Haystack, with an S3-compatible gateway (`weed s3`). Optimized for billions
  of small-to-medium files — exactly the shape of a document-signing workload.
- **Strengths:** very high small-file throughput (O(1) disk reads per file),
  volume-based replication, erasure coding for big files, simple operation for
  the size of cluster a platform like ours starts with, Apache-2.0 license.
- **Trade-offs:** the S3 gateway covers the common operations well but is not
  byte-for-byte complete; object-locking semantics are weaker than MinIO's;
  the community is smaller and documentation is more scattered.
- **Fit:** best price/performance for large fleets of envelope PDFs; the
  pragmatic default if we self-host blob storage on EU machines.

### Garage

- **What it is:** a lightweight, geo-distributed S3-compatible storage engine
  written in Rust by the Deuxfleurs collective, designed for small clusters
  across multiple sites.
- **Strengths:** truly minimal footprint (runs on a few small VMs), CRDT-based
  geo-replication fits multi-region EU setups, AGPL… no — Garage is
  **AGPL-3.0**: same licensing conversation as MinIO. Excellent durability
  model (3x replication across zones) and very low operational complexity.
- **Trade-offs:** youngest of the three; fewer production war stories, smaller
  feature surface (no object locking yet, limited lifecycle rules), and the
  project's pace depends on a small core team.
- **Fit:** attractive for a multi-site EU deployment on modest hardware, once
  its feature surface covers our retention-policy needs.

## Recommendation

1. **Stay on `STORAGE_DIR` filesystem storage** for single-node deployments —
   it is honest, simple, and the document-store abstraction already isolates
   the rest of the code from the backend.
2. **SeaweedFS** is the recommended first object store when scaling out:
   Apache-2.0, best small-file performance for PDF workloads, operationally
   simple. Use its S3 gateway behind the existing document-store interface.
3. **MinIO** if the operator wants object locking for legal hold on the
   storage layer itself and accepts the AGPL service-isolation review.
4. **Garage** to watch for multi-site EU deployments as its retention features
   mature.

Whatever backend is chosen, the integration point stays the same: implement
the document-store operations against the S3 API and keep document keys
content-addressed, so evidence packs and the transparency log remain
verifiable regardless of where the bytes live.
