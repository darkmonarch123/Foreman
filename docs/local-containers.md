# Local containers: Docker, Docker Compose and Kubernetes

Foreman runs in production on Render (see [deployment](deployment-render.md)). The files described here are for
**local development and testing only**: building Foreman as a container image, running it with Docker Compose, and
running it on the Kubernetes cluster built into Docker Desktop. Nothing here is pushed to a registry or deployed to a
production cluster.

Only the Next.js app runs in a container. Supabase (PostgreSQL, Auth, Row Level Security, Realtime) stays the managed
project in your `.env.local`.

| File                 | Purpose                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `Dockerfile`         | Multi-stage build: install, build, production-only dependencies, small non-root runtime.    |
| `.dockerignore`      | Keeps `.env*`, `node_modules`, tests and docs out of the build context.                     |
| `docker-compose.yml` | One `foreman` service on http://localhost:3000.                                             |
| `k8s/`               | Namespace, Deployment (2 replicas, rolling updates, health probes), Service, kustomization. |

## Prerequisites

- Docker Desktop, with **Settings → Kubernetes → Enable Kubernetes** for the Kubernetes part.
- `kubectl` pointing at Docker Desktop: `kubectl config use-context docker-desktop`.
- A filled-in `.env.local` (copy `.env.example`), with `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
- `http://localhost:3000/auth/confirm` in Supabase → Authentication → URL Configuration (already in the README setup).

The `NEXT_PUBLIC_*` values are compiled into the browser bundle when the image is built. They are public by design;
never pass the service-role key. Rebuild the image whenever they change.

## Docker Compose

```bash
docker compose --env-file .env.local up --build
curl http://localhost:3000/api/health      # {"status":"ok",...}
docker compose down
```

## Kubernetes on Docker Desktop

```bash
# 1. Build the image into Docker Desktop's image store (no registry needed)
set -a; source .env.local; set +a
docker build -t foreman:local \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 .

# 2. Public settings for the pods
cp k8s/foreman.env.example k8s/foreman.env   # then fill in the same public values

# 3. Deploy and inspect
docker compose down                           # free port 3000 first
kubectl apply -k k8s
kubectl -n foreman rollout status deployment/foreman
kubectl -n foreman get pods,svc
curl http://localhost:3000/api/health

# Logs, a rolling restart, and rollback
kubectl -n foreman logs -l app.kubernetes.io/name=foreman --tail=50
kubectl -n foreman rollout restart deployment/foreman
kubectl -n foreman rollout undo deployment/foreman

# Clean up
kubectl delete -k k8s
```

After rebuilding `foreman:local`, run `kubectl -n foreman rollout restart deployment/foreman` to pick it up.

## What the manifests do

- **Two replicas with `maxUnavailable: 0`**: a new version starts before an old one stops.
- **Readiness and liveness probes on `/api/health`**: a pod gets traffic only once it answers, and is restarted if
  it stops answering.
- **Hardened pod**: non-root user, no privilege escalation, all capabilities dropped, read-only root filesystem
  (writable `emptyDir` only for the Next.js cache and `/tmp`).
- **ConfigMap from `k8s/foreman.env`** (git-ignored): public settings only. There is no Secret because the app uses
  no server-side secret; every database call runs as the signed-in user under RLS.

## Limits

- Local only: no container registry, no production cluster, no ingress or TLS.
- The image bakes in one Supabase project's public URL and key; build another image for another project.
