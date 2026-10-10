# Graph Report - NekoAI-JS  (2026-08-21)

## Corpus Check
- 41 files · ~29,641 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 405 nodes · 771 edges · 23 communities (17 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f1e567b1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- types.ts
- parse-utils.ts
- run-all-tests.js
- devDependencies
- package.json
- NovelAI
- 🚀 Usage
- Metadata
- index.ts
- compilerOptions
- dependencies
- module-declarations.d.ts
- img2img-v4.5-test.js
- model-v4-5-full-test.js
- model-v4-5-inpaint-stream-test.js
- model-v4-5-inpaint-test.js
- model-v4-5-stream-test.js
- model-v4-5-vibe-transfer.js
- model-v4-cur-test.js

## God Nodes (most connected - your core abstractions)
1. `Metadata` - 32 edges
2. `NovelAI` - 29 edges
3. `Image` - 24 edges
4. `MetadataProcessor` - 24 edges
5. `ImageInput` - 14 edges
6. `🚀 Usage` - 14 edges
7. `MsgpackEvent` - 12 edges
8. `extractImageMetadata()` - 12 edges
9. `usesV4PromptEnvelope()` - 11 edges
10. `isNodeEnvironment()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `NovelAI` --references--> `Host`  [EXTRACTED]
  src/client.ts → src/constants.ts
- `Metadata` --references--> `Model`  [EXTRACTED]
  src/types.ts → src/constants.ts
- `Metadata` --references--> `Controlnet`  [EXTRACTED]
  src/types.ts → src/constants.ts
- `Metadata` --references--> `Action`  [EXTRACTED]
  src/types.ts → src/constants.ts
- `Metadata` --references--> `Resolution`  [EXTRACTED]
  src/types.ts → src/constants.ts

## Import Cycles
- 3-file cycle: `src/image.ts -> src/utils/index.ts -> src/utils/http-utils.ts -> src/image.ts`

## Communities (23 total, 6 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.09
Nodes (43): Action, Controlnet, DirectorTools, EmotionLevel, EmotionOptions, Endpoint, HEADERS, Host (+35 more)

### Community 1 - "parse-utils.ts"
Cohesion: 0.10
Nodes (26): ParsedImage, ensureDirectoryExists(), saveBinaryFile(), parseImage(), parseImageInBrowser(), parseImageInNodeJs(), uint8ArrayToBase64(), convertStealthMetadataToEntries() (+18 more)

### Community 2 - "run-all-tests.js"
Cohesion: 0.06
Nodes (33): { NovelAI, Model, Resolution, Sampler }, testCustomHost(), fs, { NovelAI }, testDirectorTools(), fs, getImageDimensions(), { NovelAI, Model, Action, Sampler, Noise } (+25 more)

### Community 3 - "devDependencies"
Cohesion: 0.05
Nodes (41): canvas, dotenv, eslint, devDependencies, canvas, dotenv, eslint, prettier (+33 more)

### Community 4 - "package.json"
Cohesion: 0.05
Nodes (40): author, bugs, url, default, description, engines, node, exports (+32 more)

### Community 5 - "NovelAI"
Cohesion: 0.15
Nodes (9): NovelAI, Image, ImageInput, NovelAIResponse, RetryConfig, calculateRetryDelay(), DEFAULT_RETRY_CONFIG, shouldRetryRequest() (+1 more)

### Community 6 - "🚀 Usage"
Cohesion: 0.08
Nodes (25): Advanced Usage Examples, Automatic Format Detection, Browser Environment, 🌟 Core Capabilities, Cross-Platform Compatibility, Custom Retry Configuration, Director Tools, 🖼️ Image Generation (+17 more)

### Community 7 - "Metadata"
Cohesion: 0.20
Nodes (6): isV5Family(), usesV4PromptEnvelope(), MetadataProcessor, DirectorReferenceDescription, Metadata, deduplicateTags()

### Community 8 - "index.ts"
Cohesion: 0.20
Nodes (13): MsgpackEvent, createMsgpackEvent(), generateXCorrelationId(), generateXInitiatedAt(), handleResponse(), parseMsgpackEvents(), parseMsgpackMessage(), parseSSEEvents() (+5 more)

### Community 9 - "compilerOptions"
Cohesion: 0.10
Nodes (19): DOM, ES2020, node_modules, src/**/*, **/*.test.ts, compilerOptions, declaration, esModuleInterop (+11 more)

### Community 10 - "dependencies"
Cohesion: 0.15
Nodes (13): exifreader, jszip, @msgpack/msgpack, dependencies, exifreader, jszip, @msgpack/msgpack, pako (+5 more)

### Community 11 - "module-declarations.d.ts"
Cohesion: 0.33
Nodes (5): exifreader, @msgpack/msgpack, pako, png-chunk-text, png-chunks-extract

### Community 12 - "img2img-v4.5-test.js"
Cohesion: 0.50
Nodes (4): fs, getImageDimensions(), { NovelAI, Model, Action, Sampler, Noise }, testImg2Img45Full()

## Knowledge Gaps
- **137 isolated node(s):** `{ NovelAI, Model, Resolution, Sampler }`, `{ NovelAI }`, `fs`, `{ NovelAI, Model, Action, Sampler, Noise }`, `fs` (+132 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.219) - this node is a cross-community bridge._
- **Why does `jszip` connect `dependencies` to `NovelAI`?**
  _High betweenness centrality (0.211) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **What connects `{ NovelAI, Model, Resolution, Sampler }`, `{ NovelAI }`, `fs` to the rest of the system?**
  _137 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09427609427609428 - nodes in this community are weakly interconnected._
- **Should `parse-utils.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `run-all-tests.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05807200929152149 - nodes in this community are weakly interconnected._