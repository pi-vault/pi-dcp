# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-06-15

### Added
- Dynamic context pruning for Pi sessions, including stale duplicate tool-output removal.
- Error-pruning strategies that clear old failed tool results after they stop being useful.
- A `compress` tool with range-based and message-based compression modes.
- DCP message IDs, compression block tracking, and proactive high-context nudges.
- Slash commands for operational control: `dcp:help`, `dcp:context`, `dcp:stats`, `dcp:sweep`, `dcp:manual`, `dcp:decompress`, `dcp:recompress`, and `dcp:lifetime`.
- Session-state persistence, lifetime statistics, debug logging, and status-bar reporting.
- Vitest coverage across config loading, strategies, message transforms, compression state, commands, persistence, pipeline behavior, and end-to-end extension lifecycle integration.
