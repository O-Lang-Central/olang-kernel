# O-Lang Kernel

Minimal O-Lang language core (parser + runtime) for agent orchestration.

---

## Overview

O-Lang is a **plain-English orchestration language** designed to let users define workflows as sequences of actions.  
This repository ships the **kernel only**—no agents, no integrations, no heavy dependencies. It is **language first**, not a framework.

> “Be the grammar. Let others build the world.” — Philosophy behind O-Lang

### What This Repository Ships

- **Parser** – Convert `.olang` files into an abstract syntax tree (AST).  
- **Runtime** – Execute the AST with a user-provided `agentResolver` function.  
- **CLI** – `olang run workflow.olang` example runner.  
- **Spec & Examples** – Minimal documentation for syntax and execution.

### What This Repository Does NOT Ship

- Agents (Slack, Groq, Google Drive, OCR, etc.)  
- PDF parsing, OCR, or databases  
- Configuration files (`.env`, secrets)  
- Desktop UI or setup wizard  

> Agents, databases, and other integrations are the responsibility of the user or third-party packages.

---

## Getting Started

### Installation

```bash
# Clone the repo
git clone https://github.com/O-Lang-Central/olang-kernel.git
cd olang

# Install dependencies (minimal parser/runtime)
npm install
