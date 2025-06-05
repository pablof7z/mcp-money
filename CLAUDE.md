# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) wallet project focused on Nostr development using the Nostr Development Kit (NDK). The project appears to be in early development stages with specification and best practices documentation in place.

## Key Documentation Files

- `Inventory.md`: Guidelines for maintaining an accurate inventory of all code files within the `src/` directory
- `NDK_Best_Practices.md`: Comprehensive best practices for using NDK core library, including connection management, signers, caching, event handling, and wallet operations
- `context/SPEC.md`: Contains MCP wallet commands specification

## Development Guidelines

### File Management
- Maintain accurate inventory in `Inventory.md` whenever creating, modifying, or deleting files in `src/`
- Follow the inventory format: `src/path/to/file.ext # concise, explicit one-liner summarizing file responsibility and scope`
- Avoid vague descriptions - entries must precisely communicate responsibilities and usage context

### NDK Development
- Always initialize NDK with explicit relay URLs (e.g., `wss://relay.damus.io`, `wss://relay.primal.net`)
- Set up signers early in application lifecycle (NDKPrivateKeySigner, NDKNip07Signer, or NDKNip46Signer)
- Use `fetchEvents()` for data fetching and `subscribeEvents()` for real-time updates
- Prefer kind wrappers (NDKArticle, NDKNote, etc.) over raw NDKEvent manipulation
- Handle zapping through NDKZapper with proper payment callbacks
- Configure cache adapters appropriately for the environment

### Project Structure
- The `src/` directory will contain the main implementation files
- Context and specification files are maintained in the `context/` directory
- Best practices and guidelines are documented in markdown files at the root level

## Architecture Notes

This project integrates MCP (Model Context Protocol) with Nostr wallet functionality, leveraging NDK for Nostr protocol interactions. The architecture appears designed for terminal-based or core library usage rather than browser-specific implementations.



# Code Snippets MCP
When you don't know what something means or how to do it, it's worthwhile checking if you can find a code snippet related to what you are trying to do via the mcp__mcp-code__*_snippets tools
