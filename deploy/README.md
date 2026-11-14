# WikiLens on a server

How WikiLens runs at https://wikilens.pgf.lv, and how to put it on another machine. It follows
that server's own conventions (`/srv/HACKATHON.md` there): one folder under `/srv/apps`, apps
listening on `127.0.0.1` only, one nginx file per project, HTTPS from certbot.

## What runs

| | Where | How |
|---|---|---|
| The page | `/srv/apps/wikilens/web/dist` | static files, served by nginx |
| The API | `127.0.0.1:3020` | systemd unit `wikilens` (`deploy/wikilens.service`), Python from `.venv` |
| MariaDB | `127.0.0.1:3021` | Docker, `deploy/docker-compose.yml`, data in the volume `wikilens_wikilens-data` |
| The embedding model (bge-m3 in Ollama) | `127.0.0.1:3022` | Docker, same file, model in the volume `wikilens_wikilens-ollama` |
| The film | `/srv/apps/wikilens/film` | static files, served by nginx at `/film/` |

Nothing but nginx listens on a public address. Database credentials and the ports are in
`/srv/apps/wikilens/.env` (mode 600, not in git).

nginx (`deploy/nginx-wikilens.conf`) adds what a page on the open internet needs and a demo on
a laptop does not: a limit of 20 questions a minute per visitor (each one runs the model), a
generous limit on everything else under `/api/`, headers that forbid framing and loading
anything from elsewhere, and errors said in the shape the page reads.

## The data is copied, not rebuilt

Loading the dataset takes minutes, but embedding 51 articles takes about half an hour on a
laptop with a GPU and would take hours on two shared CPUs. So the loaded database is moved as
it is: the data volume of the local MariaDB container, archived while the container is stopped
and unpacked into a volume on the server. The image is pinned to the same digest on both
sides, so the files open unchanged. The database passwords therefore have to be the same on
both sides.

```bash
# on the machine that has the data
docker compose stop mariadb
docker run --rm -v progresful-wikilens_wikilens-data:/var/lib/mysql:ro mariadb@sha256:4ebbcf10… \
  tar --numeric-owner -C /var/lib/mysql -cf - . | zstd -T0 -6 -o data/wikilens-db.tar.zst
docker compose start mariadb
rsync -a --partial data/wikilens-db.tar.zst SERVER:/srv/apps/wikilens/db.tar.zst

# on the server
docker volume create wikilens_wikilens-data
zstd -dc db.tar.zst | docker run --rm -i -v wikilens_wikilens-data:/var/lib/mysql mariadb@sha256:4ebbcf10… \
  tar --numeric-owner -C /var/lib/mysql -xf -
```

## Putting it up

```bash
# from the repository, after `pnpm -C web build`
rsync -aR --exclude __pycache__ backend/wikilens web/dist deploy pyproject.toml requirements.lock.txt \
  README.md LICENSES SERVER:/srv/apps/wikilens/

# on the server, in /srv/apps/wikilens
python3 -m venv .venv && .venv/bin/pip install -r requirements.lock.txt
# .env: WIKILENS_DB_USER, WIKILENS_DB_PASSWORD, WIKILENS_DB_ROOT_PASSWORD, WIKILENS_DB_NAME,
#       WIKILENS_DB_PORT=3021, WIKILENS_OLLAMA_PORT=3022, WIKILENS_OLLAMA_URL=http://127.0.0.1:3022,
#       WIKILENS_API_PORT=3020
docker compose --project-directory /srv/apps/wikilens -f deploy/docker-compose.yml up -d
docker compose --project-directory /srv/apps/wikilens -f deploy/docker-compose.yml exec ollama ollama pull bge-m3

sudo cp deploy/wikilens.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now wikilens
sudo cp deploy/nginx-wikilens.conf /etc/nginx/sites-available/wikilens
sudo ln -s /etc/nginx/sites-available/wikilens /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx          # never reload without the test: a bad file takes every site down
sudo certbot --nginx -d wikilens.pgf.lv --non-interactive --redirect
```

## Looking after it

```bash
journalctl -u wikilens -f                          # the API
sudo systemctl restart wikilens                    # after new code
docker compose --project-directory /srv/apps/wikilens -f deploy/docker-compose.yml ps
curl -s https://wikilens.pgf.lv/api/health         # {"database": true, "embedder": true}
```

A new version of the page or the API: build, run the `rsync` above, then
`sudo systemctl restart wikilens`. nginx needs nothing unless its file changed.

## Things to know

- **The first question after a quiet spell is slow.** The model leaves memory after 20 minutes
  without a question and takes some seconds to come back. The page says "asking…" meanwhile.
- **It is a small shared machine.** MariaDB has a 640 MB buffer pool here, against 2 GB on a
  laptop. The API is capped at 700 MB.
- **The Ollama image is large** (8.5 GB: it carries GPU libraries this machine does not use).
- **What is public.** Every revision of the loaded articles can be scrubbed to, including
  vandalism that Wikipedia reverted, some of it crude and some about living people. That is the
  history as it was; it is not hidden here.
