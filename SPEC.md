# O-Lang Language Specification (Phase 1)

## Core Constructs
- `Workflow "Name" with param1, param2`
- `Step N: Action using Agent`
- `Save as result`
- `If {condition} then ... End If`
- `Run in parallel ... End`
- `Return x, y.title`

## Resource Binding
- `Connect "Resource" using "uri"`
- `Agent "LogicalName" uses "Resource"`

## Observability & Adaptation
- `Debrief Agent with "message"`
- `Evolve Agent using feedback: "..."`

## I/O
- `Prompt user to "question"`
- `Persist result to "file"`
- `Emit "event" with payload`

All syntax is English-like, symbol-free, and executable.

O-Lang does not manage secrets or configuration.
Instead, it relies on the runtime environment to provide all necessary context.

Agents receive inputs via the context object (from Workflow ... with ... and Save as)
External services (API keys, endpoints) are injected via standard environment variables
Resolvers are user-provided functions that decide how to interpret action strings using process.env, secure vaults, or injected config
This keeps O-Lang:

Portable (runs in CLI, browser, serverless)
Secure (no secret handling in core)
Unopinionated (you choose your config system)