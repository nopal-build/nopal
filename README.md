# Nopal

We are a company focused on building homes for humans. Everything we do is open source and transparent. We look to learn and share all our information.

This repo houses all our software that helps us communicate, learn and share knowledge as well as provides us a space to build software tooling that can help us manage projects, cost estimates and define wall assemblies.

## Tech Stack
Remix for our front-end.

### Helpful commands:

```
# Run Dev Environment (Makefile)
$ make dev

# Older - - -

# Nopal CLI
$ cd ./crates
$ cargo run --package cli test
$ cargo run --package cli record-load-cell

# Nopal API
$ cd ./crates
$ cargo run --package nopal-api
# Run the gRPC server
$ grpcui --plaintext 0.0.0.0:8080
```


# Deploy

This site uses fly.io.

```bash
$ fly deploy
```
