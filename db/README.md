# Database

I opted to go with SurrealDB as it has more specific database types and seems more flexible for what I'm trying to achieve.

On top of that I was never great at traditional SQL so this also should help me reset expectations and approach it with a beginners mind.

## Dev Environment

To stand up a local database with default users, run:

```
make dev
```

This starts SurrealDB via Docker Compose, waits for it to be healthy, then runs `seed.surql` to set up the default namespace, database, and users.

### Default users

| User    | Scope          | Password        | Role   |
|---------|----------------|-----------------|--------|
| `root`  | Root           | `root`          | Owner  |
| `admin` | NS `nopal`     | `adminpassword` | Owner  |
| `app`   | DB `nopal/dev` | `apppassword`   | Editor |

The `app` user is what the backend service should connect with. The `admin` user is useful for exploring the database in a tool like [Surrealist](https://surrealdb.com/surrealist).

Override the root credentials at any time with environment variables:

```
SURREAL_USER=myuser SURREAL_PASS=mypass make dev
```

### Other targets

| Command        | Description                                      |
|----------------|--------------------------------------------------|
| `make seed`    | Re-run `seed.surql` against the running database |
| `make migrate` | Apply any pending migrations                     |
| `make down`    | Stop the container (data is preserved)           |
| `make reset`   | Destroy all data and start fresh                 |
| `make clean`   | Stop the container and delete the data volume    |

---

## Migrations

Migration files live in `db/migrations/` and are named `NNNN_description.surql` (e.g. `0001_add_users.surql`). The runner applies them in lexicographic order and records each successful migration in a `migration` table so it is **never applied twice**.

### Adding a migration

Create a new file in `db/migrations/` with the next number in sequence:

```
db/migrations/
  0000_init.surql        ← already applied
  0001_your_change.surql ← new file you create
```

Migration files run pre-scoped to `NS nopal / DB prod`, so you can write schema statements directly without inline `USE` statements:

```
DEFINE TABLE IF NOT EXISTS user SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS email ON user TYPE string;
```

All statements should be **idempotent** where possible — use `DEFINE … IF NOT EXISTS` for additive changes and `DEFINE … OVERWRITE` only when intentionally replacing a definition.

### Running locally

The database container must already be running (`make dev` or `docker compose up -d`).

```
make migrate
```

The runner connects to the container, bootstraps the tracking table if needed, then applies any pending migrations in order.

### Running on Fly.io

Migrations run **automatically** on every `fly deploy` via the `[deploy] release_command` in `fly.toml`:

```toml
[deploy]
  release_command = "/bin/sh /migrate.sh"
```

The release machine spins up with the new image (which includes `migrate.sh` and the full `migrations/` directory), connects to the already-running database over Fly's internal network (`<app>.flycast:8080`), and applies any pending migrations before traffic is switched to the new version.

#### Required Fly secrets

Set these once, or update them whenever credentials change:

```
fly secrets set DB_USER=root SURREAL_PASS=yourpassword
```

### How tracking works

`migrate.sh` maintains a `migration` table in `NS nopal / DB prod`:

| Field    | Type       | Description                          |
|----------|------------|--------------------------------------|
| `name`   | `string`   | Migration filename without extension |
| `run_at` | `datetime` | When the migration was applied       |

A unique index on `name` ensures each migration is recorded only once. Before applying a file the runner checks this table; if the name is already present the file is skipped.

---

## Pagination

One of the first concepts I need to tackle is pagination.

The biggest question I have is do I need to know the total counts?
I think counts across the board are a bad idea, so let's avoid it as much as possible.

Cursor based pagination isn't my dream, so I think I'll just go with offset based pagination.

By this I mean we'll fetch `limit + 1` to see if there are more items after the requested amount. Can simply strip off the last item and return the rest.

This means count() queries go away.

## API Response for Collections

```json
{
  "data": [...],
  "meta": {
    "limit": 10,
    "start": 10,
    "nextStart": 20
  }
}
```

`nextStart` is `null` if there are no more items.

## API Response for an Item

Simply return the JSON. Any errors should show up in the status code.

```json
{ ... }
```
