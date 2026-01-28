---
name: code-base-analysis
description: "Analyse a codebase and produce a technical specification in the
style of docs/velocetty-hyper-codebase.md."
---

# Codebase Analysis Skill

## Purpose

Produce a comprehensive technical specification for a codebase that mirrors
the structure, depth, and evidence-driven style of
`docs/velocetty-hyper-codebase.md`. The output should be suitable for
engineering, product, and operations stakeholders.

## When to use

- You need a full-system technical specification for an unfamiliar codebase.
- The audience expects a formal, structured document with traceability.
- You must capture architecture, flows, dependencies, and operational details.

## Inputs

- Repository root path and target output location for the document.
- Any project-specific documentation standards in `docs/`.
- Constraints on scope, depth, or timeline.

## Tooling guidance

- Use the `leta` skill for symbol discovery, call hierarchies, and structured
  code navigation.
- Use the `grepai` skill for semantic searches by intent and call graph
  tracing.
- Use exact-text tools only when needed for literals, config keys, or
  filenames.

## Workflow

### 1. Preflight and scope

- Read `README.md`, `docs/`, and the main package or build manifests.
- Identify the primary language(s), runtime(s), and supported platforms.
- Run `leta files` to get a high-level map of the repository.
- Capture version numbers, licences, and distribution targets with evidence.

### 2. Identify entry points and core execution paths

- Use `leta grep` to locate application entry points and main functions.
- Use `leta calls --from` to trace primary startup and runtime flows.
- Use `grepai trace` to validate call graphs across modules.
- Record main processes, renderer/UI processes, and IPC or RPC boundaries.

### 3. Build the feature catalogue

- Enumerate user-visible capabilities and map each to code evidence.
- Assign feature identifiers (e.g., F-001) and create requirement tables.
- For each requirement, capture implementation files and dependencies.

### 4. Map system architecture

- Define subsystems, responsibilities, and interfaces.
- Diagram main-to-renderer or service boundaries with Mermaid.
- Document data flow, control flow, and trust boundaries.
- Include integration points with external services or protocols.

### 5. Document technology stack and dependencies

- Extract runtime, build, and test tooling from manifests and config files.
- Record version constraints and dependency policies.
- Identify native modules, external services, and update channels.

### 6. Capture process and state flows

- Model key workflows (startup, session lifecycle, rendering, updates).
- Include state management flows and middleware ordering if applicable.
- Record error handling and recovery paths with evidence.

### 7. Cover system components in depth

- For each major component, describe responsibilities, inputs, outputs, and
  invariants.
- Record configuration schemas, environment variables, and on-disk formats.
- Capture extension/plugin surfaces and lifecycle hooks.

### 8. UI, testing, security, and infrastructure

- Document UI architecture, component hierarchy, and theming system.
- Summarise testing strategy, tooling, coverage, and CI pipelines.
- Describe security posture, scanning, signing, and update integrity.
- Capture build, packaging, and distribution workflows.

### 9. Appendices and reference mapping

- Provide glossaries, acronyms, and standards referenced.
- Add a repository files/folders reference table.
- Include external references with URLs where used.

## Evidence rules

- Do not speculate. If a detail is uncertain, label it as an assumption.
- Every claim about behaviour or configuration must point to a file path or
  documented source.
- Prefer tables with an "Evidence" or "File Path" column for traceability.

## Applicability matrix and scope control

Start the document with a short applicability matrix that marks which major
areas apply to the codebase. Use it to guide which sections you keep,
condense, or mark as not applicable.

| Area | Applies | Evidence | Notes |
|------|---------|----------|-------|
| UI/UX | Yes/No | File path(s) | Short rationale |
| Infrastructure | Yes/No | File path(s) | e.g. desktop vs server |
| Network services | Yes/No | File path(s) | External APIs, RPC |
| Storage | Yes/No | File path(s) | Local files, DBs, caches |
| Extension system | Yes/No | File path(s) | Plugins, hooks |

When an area does not apply:

- Keep the section heading for numbering consistency.
- Add a one-paragraph "Not applicable" note with evidence.
- If multiple adjacent sections are not applicable, replace them with a
  single "Not applicable" subsection that lists all skipped sections.

When an area partially applies:

- Condense to the minimal set of subsections that remain relevant.
- Add an explicit note describing which parts were omitted and why.

## Writing rules

- Follow the house documentation style guide in `docs/`.
- Wrap paragraphs and bullet text at 80 columns.
- Use Mermaid diagrams for architecture and flowcharts.
- Keep headings and tables unwrapped.
- Use British English spelling with "-ise" and "-our" forms.

## Output structure template

Use the following outline, expanding sections as needed. Match the naming and
depth of `docs/velocetty-hyper-codebase.md` unless scoped otherwise.

```markdown
# Technical Specification

# 1. Introduction
## 1.1 Executive Summary
## 1.2 System Overview
## 1.3 Scope
## 1.4 Document Conventions
## 1.5 References

# 2. Product Requirements
## 2.1 Feature Catalogue
## 2.2 Functional Requirements Tables
## 2.3 Feature Relationships
## 2.4 Implementation Considerations
## 2.5 Traceability Matrix
## 2.6 References

# 3. Technology Stack
## 3.1 Programming Languages
## 3.2 Frameworks and Libraries
## 3.3 Open Source Dependencies
## 3.4 Third-Party Services
## 3.5 Databases and Storage
## 3.6 Development and Deployment
## 3.7 Integration Requirements
## 3.8 Technology Stack Summary
## 3.9 References

# 4. Process Flowchart
## 4.1 System Workflows
## 4.2 Integration Workflows
## 4.3 Core Feature Flows
## 4.4 State Management Flows
## 4.5 Error Handling Flows
## 4.6 CLI Workflow
## 4.7 Sequence Diagrams
## 4.8 Validation Rules and Checkpoints
## 4.9 References

# 5. System Architecture
## 5.1 High-Level Architecture
## 5.2 Component Details
## 5.3 Process Boundaries
## 5.4 Data Flow and Storage
## 5.5 Security Architecture
## 5.6 Performance Architecture
## 5.7 References

# 6. System Components Design
## 6.1 Main Process or Backend Components
## 6.2 Renderer or UI Components
## 6.3 Shared Libraries and Utilities
## 6.4 Configuration and Profiles
## 6.5 Extension or Plugin System
## 6.6 Testing Strategy
## 6.7 References

# 7. User Interface Design
## 7.1 Overview
## 7.2 UI Architecture
## 7.3 Screen Definitions
## 7.4 State Management
## 7.5 UI and Backend Boundaries
## 7.6 Visual Design System
## 7.7 User Interactions
## 7.8 Plugin Extension Points
## 7.9 Rendering Constraints
## 7.10 Accessibility Considerations
## 7.11 References

# 8. Infrastructure
## 8.1 Infrastructure Applicability Assessment
## 8.2 Build Infrastructure
## 8.3 Cross-Platform Packaging
## 8.4 CI/CD Pipeline
## 8.5 Code Signing and Notarisation
## 8.6 Auto-Update Infrastructure
## 8.7 Security Scanning Infrastructure
## 8.8 Environment Promotion Strategy
## 8.9 Infrastructure Resource Requirements
## 8.10 Disaster Recovery and Backup
## 8.11 Infrastructure Monitoring
## 8.12 References

# 9. Appendices
## 9.1 Additional Technical Information
## 9.2 Glossary
## 9.3 Acronyms
## 9.4 References
```

## Quality checklist

- All claims link to a source file or documented external reference.
- Feature and requirement tables include evidence columns.
- Diagrams reflect actual code flow, not inferred assumptions.
- Document uses consistent terminology and definition tables.
- Section numbering aligns with the template or the agreed scope.
