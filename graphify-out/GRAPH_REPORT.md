# Graph Report - DocumentUnderstanding  (2026-11-24)

## Corpus Check
- 191 files · ~158,923 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 7, .css 2, .lock 1)

## Summary
- 4790 nodes · 10348 edges · 238 communities (126 shown, 112 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 441 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6cac967d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pdf.worker.min.mjs
- run_acceptance.py
- App.jsx
- test_retrieval.py
- TemplateNamespace
- OptionObject
- test_oracle_metrics.py
- XFAObjectArray
- XFAObject
- Element
- ProvenanceConfig
- StringObject
- LocaleSetNamespace
- LayoutOrderRecovery
- ConfigNamespace
- test_leakage.py
- Option01
- PDFEditor
- stringToPDFString
- CFFCompiler
- .success
- shadow
- PDFDocument
- XhtmlObject
- .getTextContent
- Dict
- ContentObject
- RefMap
- test_api_integration.py
- PartialEvaluator
- getStringOption
- ColorSpace
- info
- Text
- .fallbackToSystemFont
- ChunkedStream
- run_ablation.py
- .checkAndRepair
- ._create
- WidgetAnnotation
- Type1Font
- DoclingExtractor
- PsWasmCompiler
- Annotation
- ConnectionSetNamespace
- DocumentService
- Glyph
- IntegerObject
- MathClamp
- common.py
- FileSpec
- .get
- main.py
- NegativeAnomalyRecord
- assert
- compileCharString
- OperatorList
- BaseStream
- FormatError
- BaseResponse
- .getOperatorList
- warn
- PsNode
- Page
- Retrieva AI — Multi-Document Intelligence Architecture (`docs/multi_document_architecture.md`)
- GroundTruthElement
- calculateSHA512
- CFFParser
- .createDocumentHandler
- ExclGroup
- .loadFont
- Value
- Type1Parser
- documents
- steps
- Settings
- .getOperatorList
- .constructor
- unreachable
- CMap
- WasmImage
- Retrieva AI — Evidence Layer & Partitioning Plan
- TextMeasure
- questions
- questions
- Binder
- decodeScan
- IccColorSpace
- XFAFactory
- PSStackToTree
- XMLParserBase
- Retrieva AI — Ground-Truth Annotation Guide
- .ensureBuffer
- BasePdfManager
- Builder
- .constructPostScript
- XmlObject
- fixture_nt4_leakage_manifest.yaml
- Area
- DecodeStream
- ButtonWidgetAnnotation
- MessageHandler
- Retrieva AI — Acceptance Verification & Evaluation Integrity Report
- ADR 001: Evaluation and Selection of Primary Document Extraction Architecture
- incrementalUpdate
- SingleIntersector
- Stream
- Util
- Retrieva AI — REST API Reference Manual
- Retrieva AI — Production Operations & Reliability Guide
- CalRGBCS
- SimpleDOMNode
- ImageResizer
- JpegImage
- NullOptimizer
- test_multi_document.py
- Provenance, Multi-Signal Confidence, and Degraded Routing Subsystem (O3)
- isArrayEqual
- t
- na
- JpegStream
- Retrieva AI — Multi-Modal Document Intelligence & Cross-Document Spatial Retrieval System
- 3. Named Anchors
- Downstream Retrieval Evaluation: Naive Ingestion vs. O2 Reference vs. O2+O3
- BasePDFStreamReader
- XFAParser
- calculateSHA256
- .makeHexColor
- SimpleXMLParser
- Datasets
- FontFinder
- XFAAttribute
- Retrieva AI — Final Acceptance Evaluation Report
- Jbig2Stream
- LabCS
- lexer_Lexer
- Retrieva AI — Environment Verification Report
- Retrieva AI — Frontend Testing Report
- Option10
- AESBaseCipher
- BasePDFStream
- BrotliStream
- updateXFA
- IdentityToUnicodeMap
- MeshStreamReader
- PsJsCompiler
- XRefWrapper
- 3. Complete Step-by-Step User Workflow
- .setBorderStyle
- BasePDFStreamRangeReader
- BinaryCMapStream
- .isUsable
- MetadataParser
- Endpoints Summary
- .oxlintrc.json
- createValidAbsoluteUrl
- CCITTFaxStream
- CFFFont
- .parseKid
- searchNode
- HTMLResult
- JpxStream
- Template
- xdp_Xdp
- 7. Quickstart & Reproduction Guide
- vercel.json
- get_health
- Retrieva AI — Architecture Documentation
- LocalPdfManager
- PageSet
- .#Ee
- signature_Signature
- Stylesheet
- Traverse
- Retrieva AI — Backend Testing Report
- get_latest_evaluation_report
- Retrieva AI — Data Repository
- 3. Document Management Endpoints
- 3. Operational Health Monitoring (`/api/v1/health`)
- Assist
- Border
- EquateRange
- PageRange
- ImageEdit
- Linear
- LZWStream
- Margin
- Occur
- Overflow
- Radial
- Root
- Solid
- StreamsSequenceStream
- template_Pattern
- Variables
- Retrieva AI — Negative Testing Report (NT1 – NT5)
- Reproducible Builds & Development Environments
- Bind
- Button
- Certificates
- Comb
- config_Encryption
- DuplexOption
- Equate
- IfEmpty
- Log
- Output
- Pcl
- Presence
- RenderPolicy
- SilentPrint
- SubmitFormat
- Threshold
- Type
- DateTimeEdit
- DigestMethods
- Encodings
- EncryptData
- EncryptionMethods
- Event
- Execute
- Hyphenation
- Issuers
- Line
- Manifest
- NullCipher
- SetProperty
- SignData
- template_Font
- Validate
- retrieva-ai

## God Nodes (most connected - your core abstractions)
1. `XFAObject` - 217 edges
2. `warn()` - 173 edges
3. `ConfigNamespace` - 141 edges
4. `TemplateNamespace` - 115 edges
5. `shadow()` - 104 edges
6. `FormatError` - 89 edges
7. `getStringOption()` - 85 edges
8. `XFAObjectArray` - 66 edges
9. `Element` - 64 edges
10. `PDFEditor` - 60 edges

## Surprising Connections (you probably didn't know these)
- `7. API Specifications & Endpoints` --references--> `SearchQueryRequest`  [INFERRED]
  docs/multi_document_architecture.md → backend/app/schemas/common.py
- `1. Context & Problem Statement` --references--> `Element`  [INFERRED]
  docs/adr_001_reference_choice.md → backend/extractors/base.py
- `2. Architectural Comparison of Candidates` --references--> `LayoutOrderRecovery`  [INFERRED]
  docs/adr_001_reference_choice.md → backend/layout/order_recovery.py
- `3.2 Reading-Order Recovery Gains (KPI-1)` --references--> `LayoutOrderRecovery`  [INFERRED]
  docs/adr_001_reference_choice.md → backend/layout/order_recovery.py
- `Recommended Decision: Tiered Dual-Engine Strategy` --references--> `LayoutOrderRecovery`  [INFERRED]
  docs/adr_001_reference_choice.md → backend/layout/order_recovery.py

## Import Cycles
- None detected.

## Communities (238 total, 112 thin omitted)

### Community 0 - "pdf.worker.min.mjs"
Cohesion: 0.01
Nodes (165): addChildren(), addHex(), af, Ai, al, an, Ao, ar (+157 more)

### Community 1 - "run_acceptance.py"
Cohesion: 0.05
Nodes (35): get_settings(), main(), 3. Negative Anomaly Suite Traceability (NT1 – NT5), detect_flattened_table(), detect_scrambled_reading_order(), NegativeTestAbstentionError, UncheckedDownstreamRetrievalError, verify_downstream_retrieval_check() (+27 more)

### Community 2 - "App.jsx"
Cohesion: 0.05
Nodes (73): dependencies, lucide-react@^1.47.0, pdfjs-dist@^6.4.299, react@^19.2.8, react-dom@^19.2.8, tailwindcss@^4.3.3, @tailwindcss/vite@^4.3.3, devDependencies (+65 more)

### Community 3 - "test_retrieval.py"
Cohesion: 0.04
Nodes (24): BaseChunker, NaiveFlatChunker, BaseEmbedding, DenseDeterministicEmbedding, BaseRetriever, FaissRetriever, Chunk, RetrievalResult (+16 more)

### Community 4 - "TemplateNamespace"
Cohesion: 0.02
Nodes (29): AppearanceFilter, Arc, Barcode, BindItems, Bookend, Break, BreakAfter, BreakBefore (+21 more)

### Community 5 - "OptionObject"
Cohesion: 0.02
Nodes (28): ADBE_JSConsole, ADBE_JSDebugger, Attributes, AutoSave, config_Validate, Conformance, Destination, DigestMethod (+20 more)

### Community 6 - "test_oracle_metrics.py"
Cohesion: 0.04
Nodes (36): 2.1 KPI-1: Reading-Order Accuracy, 2.2 KPI-2: Table Structure Fidelity, 2.3 KPI-3: Downstream Retrieval & Synthesis Quality, 2.4 KPI-4: Formula Extraction Match Rate, 2. Detailed Evidence Breakdown by KPI, Retrieva AI — Source-to-Claim Traceability Matrix, calculate_critical_scene_failure_rate(), calculate_f1_score() (+28 more)

### Community 7 - "XFAObjectArray"
Cohesion: 0.02
Nodes (25): Acrobat, Agent, Common, Config, config_FontInfo, ConnectionSet, Data, Desc (+17 more)

### Community 8 - "XFAObject"
Cohesion: 0.02
Nodes (13): BatchOutput, Compress, config_Area, Filter, Items, LabelPrinter, Medium, PageOffset (+5 more)

### Community 9 - "Element"
Cohesion: 0.06
Nodes (22): BoundingBox, Element, ElementType, FormulaData, TableCell, PdfPlumberExtractor, compute_box_iou(), compute_dual_extractor_agreement() (+14 more)

### Community 10 - "ProvenanceConfig"
Cohesion: 0.06
Nodes (24): apply_platt_scaling(), combine_confidence_signals(), compute_expected_calibration_error(), fit_platt_parameters(), ProvenanceConfig, DegradedPathRouter, CalibrationReport, ConfidenceSignals (+16 more)

### Community 11 - "StringObject"
Cohesion: 0.03
Nodes (25): Amd, Base, Certificate, config_Picture, Creator, Enforce, ExcludeNS, GroupParent (+17 more)

### Community 12 - "LocaleSetNamespace"
Cohesion: 0.03
Nodes (25): CalendarSymbols, CurrencySymbol, CurrencySymbols, DatePattern, DatePatterns, DateTimeSymbols, Day, DayNames (+17 more)

### Community 13 - "LayoutOrderRecovery"
Cohesion: 0.05
Nodes (22): LayoutConfig, LayoutOrderRecovery, recover_reading_order(), 3.3 Upload & Ingest PDF Document, 5.2 CLI Recovery Tool (`eval/recovery.py`), calculate_reading_order_accuracy(), run_kpi1_report(), evaluate_extractor_on_document() (+14 more)

### Community 14 - "ConfigNamespace"
Cohesion: 0.03
Nodes (21): Acrobat7, Cache, Compression, config_Message, config_Script, config_Template, ConfigNamespace, Debug (+13 more)

### Community 15 - "test_leakage.py"
Cohesion: 0.06
Nodes (28): 5. Leakage Prevention Guarantees & Enforcement, Layer 1: Document ID Mutual Exclusion, Layer 2: Page-Level Entity Boundary, Layer 3: Derived Artifact Boundary, Layer 4: Cryptographic Lock Verification, DataLeakageError, extract_doc_id_from_identifier(), run_leakage_audit() (+20 more)

### Community 16 - "Option01"
Cohesion: 0.03
Nodes (20): AddSilentPrint, AddViewerPreferences, Change, CompressLogicalStructure, config_Encrypt, ContentCopy, DocumentAssembly, Embed (+12 more)

### Community 17 - "PDFEditor"
Cohesion: 0.08
Nodes (4): PageData, PDFEditor, stringToAsciiOrUTF16BE(), stringToUTF16String()

### Community 18 - "stringToPDFString"
Cohesion: 0.07
Nodes (16): appendIfJavaScriptDict(), parseNestedOrder(), parseOrder(), ChoiceWidgetAnnotation, _collectAction(), collectActions(), _collectJS(), fetchRemoteDest() (+8 more)

### Community 19 - "CFFCompiler"
Cohesion: 0.06
Nodes (11): ARCFourCipher, calculateMD5(), CFFCompiler, CFFIndex, CFFOffsetTracker, CipherTransform, CipherTransformFactory, PasswordException (+3 more)

### Community 20 - ".success"
Cohesion: 0.09
Nodes (33): applyAssist(), ariaLabel(), CheckButton, checkDimensions(), ChoiceList, computeBbox(), Corner, createWrapper() (+25 more)

### Community 21 - "shadow"
Cohesion: 0.06
Nodes (7): Catalog, FeatureTest, fetchDest(), InfoUtils, NameTree, ro, shadow()

### Community 22 - "PDFDocument"
Cohesion: 0.05
Nodes (6): find(), InvalidPDFException, PDFDocument, Ref, XRef, XRefEntryException

### Community 23 - "XhtmlObject"
Cohesion: 0.04
Nodes (19): a, B, Body, Br, buildHuffmanTable(), Html, I, Li (+11 more)

### Community 24 - ".getTextContent"
Cohesion: 0.06
Nodes (25): BaseLocalCache, Commands, LocalGStateCache, LocalImageCache, LocalTilingPatternCache, addFakeSpaces(), appendEOL(), applyInverseRotation() (+17 more)

### Community 25 - "Dict"
Cohesion: 0.05
Nodes (11): codePointIter(), createImage(), createImageDict(), createPNGLikeImage(), createRawImage(), Dict, FakeUnicodeFont, paethPredictor() (+3 more)

### Community 26 - "ContentObject"
Cohesion: 0.04
Nodes (14): AlwaysEmbed, BehaviorOverride, ContentObject, DefaultTypeface, Exclude, ExData, NeverEmbed, Range (+6 more)

### Community 27 - "RefMap"
Cohesion: 0.06
Nodes (7): clearGlobalCaches(), DocumentData, GlobalColorSpaceCache, GlobalImageCache, makeSet(), RefMap, XRefParseException

### Community 28 - "test_api_integration.py"
Cohesion: 0.06
Nodes (21): create_sample_pdf_bytes(), test_degraded_flag_never_silent(), test_get_page_layout_out_of_bounds_404(), test_get_page_layout_segments_and_provenance(), test_get_page_layout_unknown_document_404(), test_health_metrics_payload(), test_recovery_path_reload_accepted_bundle(), test_search_content_type_filtering() (+13 more)

### Community 29 - "PartialEvaluator"
Cohesion: 0.08
Nodes (22): adjustWidths(), CMapFactory, fetchBinaryData(), generateFont(), getEncoding(), getFamilyName(), getFontSubstitution(), getStandardFontName() (+14 more)

### Community 30 - "getStringOption"
Cohesion: 0.10
Nodes (8): getFloat(), getInteger(), getKeyword(), getMeasurement(), getRatio(), getRelevant(), getStringOption(), LockDocument

### Community 31 - "ColorSpace"
Cohesion: 0.06
Nodes (8): AlternateCS, CalGrayCS, ColorSpace, ColorSpaceUtils, DeviceGrayCS, DeviceRgbaCS, DeviceRgbCS, PatternCS

### Community 32 - "info"
Cohesion: 0.09
Nodes (9): Ascii85Stream, Cmd, EvaluatorPreprocessor, findBlock(), info(), isWhiteSpace(), Linearization, Parser (+1 more)

### Community 33 - "Text"
Cohesion: 0.05
Nodes (9): BooleanElement, DateElement, DateTime, Decimal, Float, Integer, Text, Time (+1 more)

### Community 34 - ".fallbackToSystemFont"
Cohesion: 0.06
Nodes (19): amendFallbackToUnicode(), applyStandardFontGlyphMap(), bn, buildToFontChar(), convertCidString(), ds, Font, fonts_Glyph (+11 more)

### Community 35 - "ChunkedStream"
Cohesion: 0.09
Nodes (5): arrayBuffersToBytes(), ChunkedStream, ChunkedStreamManager, MissingDataException, NetworkPdfManager

### Community 36 - "run_ablation.py"
Cohesion: 0.08
Nodes (14): calculate_bootstrap_ci(), calculate_per_condition_breakdowns(), compute_aggregate_retrieval_metrics(), evaluate_retrieval_query(), execute_ablation_study(), load_dev_partitions(), load_ground_truth(), load_manifest_records() (+6 more)

### Community 37 - ".checkAndRepair"
Cohesion: 0.08
Nodes (20): adjustMapping(), createCmapTable(), createNameTable(), createOS2Table(), createPostscriptName(), createPostTable(), DataBuilder, readNameTable() (+12 more)

### Community 38 - "._create"
Cohesion: 0.10
Nodes (16): CaretAnnotation, CircleAnnotation, FileAttachmentAnnotation, getPdfColorArray(), getQuadPoints(), HighlightAnnotation, LineAnnotation, LinkAnnotation (+8 more)

### Community 39 - "WidgetAnnotation"
Cohesion: 0.11
Nodes (12): DefaultAppearanceEvaluator, escapeString(), FreeTextAnnotation, getPdfColor(), InkAnnotation, numberToString(), parseDefaultAppearance(), SignatureWidgetAnnotation (+4 more)

### Community 40 - "Type1Font"
Cohesion: 0.07
Nodes (8): CFF, CFFCharset, CFFDict, CFFHeader, CFFPrivateDict, CFFStrings, CFFTopDict, Type1Font

### Community 41 - "DoclingExtractor"
Cohesion: 0.08
Nodes (9): BaseExtractor, DoclingExtractor, get_extractor(), __getattr__(), test_confidence_threshold_bounds(), test_docling_extractor_extracts_placeholder_pdf(), test_extractor_raises_on_nonexistent_file(), test_get_extractor_factory() (+1 more)

### Community 42 - "PsWasmCompiler"
Cohesion: 0.19
Nodes (6): encodeASCIIString(), PsWasmCompiler, section(), Ui, unsignedLEB128(), vec()

### Community 44 - "ConnectionSetNamespace"
Cohesion: 0.06
Nodes (12): connection_set_Uri, ConnectionSetNamespace, EffectiveInputPolicy, EffectiveOutputPolicy, Operation, RootElement, SoapAction, SoapAddress (+4 more)

### Community 45 - "DocumentService"
Cohesion: 0.10
Nodes (6): get_document(), upload_document(), upload_documents_batch(), DocumentMetrics, DocumentSummary, DocumentService

### Community 46 - "Glyph"
Cohesion: 0.07
Nodes (6): CompositeGlyph, Contour, GlyfTable, Glyph, GlyphHeader, SimpleGlyph

### Community 47 - "IntegerObject"
Cohesion: 0.07
Nodes (10): AdobeExtensionLevel, Copies, CurrentPage, IntegerObject, Level, MsgId, NumberOfCopies, Part (+2 more)

### Community 48 - "MathClamp"
Cohesion: 0.11
Nodes (11): BaseShading, buildMeshVertexData(), DummyShading, FunctionBasedShading, getB(), getColorConversionBatchSize(), IndexedCS, MathClamp() (+3 more)

### Community 49 - "common.py"
Cohesion: 0.13
Nodes (10): execute_aggregate_search(), execute_search(), BatchItemStatus, BoundingBox, CrossDocumentEvidence, HealthData, MultiDocumentSearchResponse, SearchQueryRequest (+2 more)

### Community 50 - "FileSpec"
Cohesion: 0.13
Nodes (6): FileSpec, getSoundFormat(), MediaAnnotation, RichMediaAnnotation, ScreenAnnotation, SoundAnnotation

### Community 51 - ".get"
Cohesion: 0.10
Nodes (5): makeArr(), Name, NumberTree, StructTreePage, StructTreeRoot

### Community 52 - "main.py"
Cohesion: 0.10
Nodes (4): reload_accepted_config(), create_app(), lifespan(), get_document_service()

### Community 53 - "NegativeAnomalyRecord"
Cohesion: 0.09
Nodes (11): NegativeAnomalyRecord, NegativeTestRecorder, 1. Executive Defect Summary, 2. Detailed Defect Catalog, 3. Overall Campaign Test Disposition, DEF-001: Semantic Substitution of Charter KPIs (KPI-4 & KPI-5), DEF-002: Silent Catch-and-Fallback to Mock Data in Client API Layer, DEF-003: Missing Canonical `negative_latest.json` Telemetry Link (+3 more)

### Community 54 - "assert"
Cohesion: 0.13
Nodes (9): assert(), compileFontInfo(), writeBuffer(), convertBlackAndWhiteToRGBA(), convertToRGBA(), encodeStrings(), PDFImage, toRomanNumerals() (+1 more)

### Community 55 - "compileCharString"
Cohesion: 0.09
Nodes (10): compileCharString(), CompiledFont, compileGlyf(), FontRendererFactory, getFloat214(), getSubroutineBias(), lookupCmap(), parseCff() (+2 more)

### Community 56 - "OperatorList"
Cohesion: 0.11
Nodes (3): getTransformMatrix(), lookupRect(), OperatorList

### Community 58 - "FormatError"
Cohesion: 0.16
Nodes (14): expectInt(), expectString(), FlateStream, FormatError, isCmd(), parseBfChar(), parseBfRange(), parseCidChar() (+6 more)

### Community 59 - "BaseResponse"
Cohesion: 0.12
Nodes (8): delete_document(), get_analytics_summary(), get_batch_status(), get_document_file(), get_page_layout(), list_documents(), BaseResponse, BatchUploadResponse

### Community 60 - ".getOperatorList"
Cohesion: 0.10
Nodes (8): addCachedImageOps(), argIsDict(), CheckedOperatorList, EvalState, getTilingPatternIR(), lookupMatrix(), lookupNormalRect(), nodeToSerializable()

### Community 61 - "warn"
Cohesion: 0.15
Nodes (8): addPageError(), parseOperand(), isDefaultDecodeHelper(), Lexer, parseMarkedContentProps(), _parseVisibilityExpression(), toHexDigit(), warn()

### Community 62 - "PsNode"
Cohesion: 0.12
Nodes (10): ast_Parser, PsArgNode, PsBlock, PsIf, PsIfElse, PsNode, PsNumber, PsOperator (+2 more)

### Community 64 - "Retrieva AI — Multi-Document Intelligence Architecture (`docs/multi_document_architecture.md`)"
Cohesion: 0.08
Nodes (24): 10. Multi-Document Development Benchmark (`eval/run_multi_doc_eval.py`), 11. Implementation Phasing & Task Breakdown, 12. Verification & Safety Invariants, 1. Executive Summary & Architectural Goals, 2. System Architecture & Component Interaction, 3.1 Batch Document Ingestion Flow, 3.2 Cross-Document Search & Evidence Aggregation Flow, 3. Detailed Data Flow (+16 more)

### Community 65 - "GroundTruthElement"
Cohesion: 0.13
Nodes (8): BoundingBox, FormulaAnnotation, GroundTruthElement, PageGroundTruth, TableAnnotation, TableCellAnnotation, test_page_ground_truth_rejects_duplicate_reading_orders(), test_page_ground_truth_schema_valid()

### Community 66 - "calculateSHA512"
Cohesion: 0.10
Nodes (11): AES128Cipher, calculateSHA384(), calculateSHA512(), ch(), littleSigma(), littleSigmaPrime(), maj(), PDF20 (+3 more)

### Community 67 - "CFFParser"
Cohesion: 0.16
Nodes (5): CFFEncoding, CFFFDSelect, CFFParser, looksLikeUnsigned16BitNegative(), recoverSigned16BitBBox()

### Community 68 - ".createDocumentHandler"
Cohesion: 0.16
Nodes (12): AbortException, WorkerMessageHandler, ensureNotTerminated(), finishWorkerTask(), getPassword(), loadDocument(), setupDoc(), onFailure() (+4 more)

### Community 69 - "ExclGroup"
Cohesion: 0.10
Nodes (6): addHTML(), createLine(), ExclGroup, flushHTML(), getAvailableSpace(), Subform

### Community 70 - ".loadFont"
Cohesion: 0.10
Nodes (4): ErrorFont, MurmurHash3_64, buildPath(), TranslatedFont

### Community 71 - "Value"
Cohesion: 0.10
Nodes (6): Caption, Draw, Field, Image, _setValue(), Value

### Community 72 - "Type1Parser"
Cohesion: 0.22
Nodes (5): decrypt(), isHexDigit(), isSpecial(), Type1CharString, Type1Parser

### Community 73 - "documents"
Cohesion: 0.10
Nodes (19): created_date, custodian, documents, access_date, description, document_type, file_path, has_formulas (+11 more)

### Community 74 - "steps"
Cohesion: 0.11
Nodes (18): name, runs-on, steps, jobs, build-lint-test, name, on, pull_request (+10 more)

### Community 75 - "Settings"
Cohesion: 0.12
Nodes (5): Settings, client(), test_settings(), test_config_version_non_empty(), test_upload_size_limit_bounds()

### Community 76 - ".getOperatorList"
Cohesion: 0.14
Nodes (4): AnnotationFactory, deepCompare(), getNewAnnotationsMap(), isRefsEqual()

### Community 77 - ".constructor"
Cohesion: 0.11
Nodes (4): AppearanceStreamEvaluator, LocalColorSpaceCache, LocalFunctionCache, PDFFunctionFactory

### Community 78 - "unreachable"
Cohesion: 0.14
Nodes (3): IdentityCMap, Pattern, unreachable()

### Community 80 - "WasmImage"
Cohesion: 0.14
Nodes (4): JBig2CCITTFaxImage, JpxError, JpxImage, WasmImage

### Community 81 - "Retrieva AI — Evidence Layer & Partitioning Plan"
Cohesion: 0.12
Nodes (16): 1. Executive Summary & Foundational Principles, 2.1 Manifest Schema Attributes, 2.2 Pre-Modelling Document Inventory, 2. Document Manifest Specification (`/data/manifest.yaml`), 3.1 The Document-Level Granularity Rule, 3.2 Fixed Seed Determinism ($S = 42$), 3. Partitioning Methodology & Invariants, 4.1 Tamper Detection Invariant (+8 more)

### Community 82 - "TextMeasure"
Cohesion: 0.16
Nodes (5): FontInfo, FontSelector, layoutText(), selectFont(), TextMeasure

### Community 83 - "questions"
Cohesion: 0.12
Nodes (15): benchmark_name, created_date, questions, expected_answer, gold_doc_id, gold_element_id, gold_element_type, gold_page (+7 more)

### Community 84 - "questions"
Cohesion: 0.12
Nodes (15): benchmark_name, created_date, questions, expected_answer, gold_doc_id, gold_element_id, gold_element_type, gold_page (+7 more)

### Community 86 - "decodeScan"
Cohesion: 0.23
Nodes (12): buildComponentData(), decodeScan(), decodeHuffman(), readBit(), receive(), receiveAndExtend(), findNextFileMarker(), JpegError (+4 more)

### Community 87 - "IccColorSpace"
Cohesion: 0.16
Nodes (5): CmykICCBasedCS, DeviceCmykCS, IccColorSpace, passArray8ToWasm0(), qcms_convert_array()

### Community 89 - "PSStackToTree"
Cohesion: 0.26
Nodes (5): _nodesEqual(), PsBinaryNode, PsConstNode, PSStackToTree, PsTernaryNode

### Community 91 - "Retrieva AI — Ground-Truth Annotation Guide"
Cohesion: 0.13
Nodes (14): 1. Introduction & Objectives, 2. Coordinate System & Spatial Geometry, 3. Element Types & Classification Criteria, 4. Reading Order Indexing (`reading_order`), 5. Table Grid Structure & Span Topology, 6. Formula Annotation & LaTeX Standards, 7.1 What is a "Critical Scene"?, 7.2 Criteria for Designating Critical Scenes (+6 more)

### Community 92 - ".ensureBuffer"
Cohesion: 0.14
Nodes (4): AsciiHexStream, DecryptStream, PredictorStream, RunLengthStream

### Community 94 - "Builder"
Cohesion: 0.19
Nodes (3): Builder, Empty, UnknownNamespace

### Community 95 - ".constructPostScript"
Cohesion: 0.29
Nodes (6): buildPostScriptWasmFunction(), interpolate(), parsePostScriptFunction(), PDFFunction, setArity(), toNumberArray()

### Community 97 - "fixture_nt4_leakage_manifest.yaml"
Cohesion: 0.13
Nodes (14): acceptance_split, id, partition, title, anomaly_type, config_version, derived_artifacts_in_dev_cache, description (+6 more)

### Community 98 - "Area"
Cohesion: 0.14
Nodes (3): Area, getContainedChildren(), SubformSet

### Community 101 - "MessageHandler"
Cohesion: 0.22
Nodes (3): MessageHandler, PDFWorkerStreamReader, wrapReason()

### Community 102 - "Retrieva AI — Acceptance Verification & Evaluation Integrity Report"
Cohesion: 0.14
Nodes (13): 1. Authoritative Charter Acceptance Criteria (AC-1 to AC-4), 2. Six Original Charter Key Performance Indicators (KPI-1 to KPI-6), 3. Auxiliary Subsystem Metrics, 4.1 Frozen Acceptance Partition Cryptographic Verification, 4.2 Documentation Inconsistencies Discovered, 4. Evaluation Integrity & Document Consistency Audit, 5. Formal Acceptance Certification, AC-1: Representative Operation on Frozen Unseen Documents (+5 more)

### Community 103 - "ADR 001: Evaluation and Selection of Primary Document Extraction Architecture"
Cohesion: 0.15
Nodes (12): 1. Context & Problem Statement, 2. Architectural Comparison of Candidates, 3.1 Performance & Resource Footprint (KPI-6), 3.2 Reading-Order Recovery Gains (KPI-1), 3. Empirical Benchmark Results, 4. Architectural Analysis & Trade-offs, 5. Architectural Decision, 6. Verification & Reproducibility Runbook (+4 more)

### Community 104 - "incrementalUpdate"
Cohesion: 0.22
Nodes (13): bytesToString(), computeIDs(), escapePDFName(), getFontFileType(), getIndexes(), getSizeInBytes(), incrementalUpdate(), isTrueTypeCollectionFile() (+5 more)

### Community 108 - "Retrieva AI — REST API Reference Manual"
Cohesion: 0.17
Nodes (11): 1. Global Response Envelope Schema, 2.1 Root Discovery, 2.2 System Health & Telemetry, 2.3 System Recovery & Bundle Reload, 2. System Endpoints, 4.1 Execute Search, 4. Multi-Modal Retrieval Endpoint, 5.1 Latest Evaluation Report (+3 more)

### Community 109 - "Retrieva AI — Production Operations & Reliability Guide"
Cohesion: 0.17
Nodes (12): 1. Overview & Service Architecture, 2.1 Logging Design & Format, 2.2 Response Headers, 2.3 Error Logging & Tracking, 2. Structured JSON Logging, 4.1 Trigger Conditions, 4.2 System Behavior in Degraded Mode, 4. Degraded Mode & Anomaly Handling (+4 more)

### Community 115 - "test_multi_document.py"
Cohesion: 0.33
Nodes (8): create_test_pdf(), test_analytics_summary_endpoint(), test_batch_upload_duplicate_detection(), test_batch_upload_multiple_documents(), test_client(), test_cross_document_selective_search(), test_delete_document_and_purge_faiss_index(), test_search_aggregate_endpoint()

### Community 116 - "Provenance, Multi-Signal Confidence, and Degraded Routing Subsystem (O3)"
Cohesion: 0.18
Nodes (10): 1. Overview & Architectural Goals, 2.1 Provenance Record & Cryptographic Audit Trail, 2.2 Multi-Signal Confidence Fusion & Platt Calibration, 2.3 Degraded Path Routing, 2. Core Subsystem Components, 3.1 Effect Size Analysis (95% Bootstrap Confidence Intervals), 3. Empirical Ablation Study Results, 4. Honest Negative Results & Engineering Trade-Offs (+2 more)

### Community 117 - "isArrayEqual"
Cohesion: 0.31
Nodes (3): AES256Cipher, isArrayEqual(), PDFBase

### Community 118 - "t"
Cohesion: 0.24
Nodes (11): decodeBlock(), decodeMcu(), en(), receiveInstance(), updateMemoryViews(), getBlockBufferOffset(), k, on() (+3 more)

### Community 119 - "na"
Cohesion: 0.18
Nodes (6): DNLMarkerError, EOIMarkerError, Jbig2Error, na, ResponseException, UnknownErrorException

### Community 121 - "Retrieva AI — Multi-Modal Document Intelligence & Cross-Document Spatial Retrieval System"
Cohesion: 0.18
Nodes (11): 10. System Boundaries & Limitations, 11. License, 1. What is Retrieva AI? (Plain English Overview), 2. Why Standard AI Fails on Documents, 4. System Architecture & Data Pipeline, 6. Live Real-File Analytics (Zero Dummy Data Guarantee), 8. Certified Empirical Benchmark Results (KPI-1 to KPI-6), 9. REST API Endpoint Reference (+3 more)

### Community 122 - "3. Named Anchors"
Cohesion: 0.20
Nodes (9): 1. Overview & Objective, 2. Observable Scoring Criteria (0–100 Points Total), 3. Named Anchors, 4. Instructions for Independent Raters, Anchor 0 — Complete Retrieval Failure / Unanchored Hallucination (0 Pts), Anchor 100 — Flawless Cryptographic Grounding & Modality Integrity (100 Pts), Anchor 50 — Partial Retrieval / Severe Structural Fragmentation (50 Pts), Anchor 80 — Production Competent / Minor Audit Gap (80 Pts) (+1 more)

### Community 123 - "Downstream Retrieval Evaluation: Naive Ingestion vs. O2 Reference vs. O2+O3"
Cohesion: 0.20
Nodes (9): 1. Executive Summary, 2. Quantitative Benchmark Results, 3.1 Table Lookups (Critical Finding), 3.2 Multi-Column Reading Order, 3. Condition-Wise Modality Breakdown, 4.1 Inter-Rater Reliability (Cohen's Kappa), 4. KPI-3 Rubric Analysis & Inter-Rater Consensus, 5. Architectural Recommendations & Conclusion (+1 more)

### Community 126 - "calculateSHA256"
Cohesion: 0.27
Nodes (9): calculate_sha256_ch(), calculate_sha256_littleSigma(), calculate_sha256_littleSigmaPrime(), calculate_sha256_maj(), calculate_sha256_sigma(), calculate_sha256_sigmaPrime(), calculateSHA256(), PDF17 (+1 more)

### Community 129 - "Datasets"
Cohesion: 0.20
Nodes (3): Datasets, datasets_Data, DatasetsNamespace

### Community 130 - "FontFinder"
Cohesion: 0.24
Nodes (3): FontFinder, makeObj(), stripQuotes()

### Community 132 - "Retrieva AI — Final Acceptance Evaluation Report"
Cohesion: 0.22
Nodes (9): 1. Executive Summary, 2. Cryptographic Partition Lock & Zero-Leakage Audit, 3. Negative Anomaly Suite Audit (Zero Silent Failures), 4. Key Performance Indicator (KPI) Acceptance Matrix, 5. Stratified Subgroup Performance Breakdowns (AC-3), 6. Parity Evaluation: Reference (O2) vs. Final (O2+O3) (AC-4), 7. Downstream Retrieval & Synthesis Quality (KPI-3), 8. Non-Tuning & Methodological Integrity Certification (+1 more)

### Community 136 - "Retrieva AI — Environment Verification Report"
Cohesion: 0.22
Nodes (8): 1. Executive Environment Summary, 2.1 Python Virtual Environment, 2.2 Node.js Frontend Dependencies, 2. Dependency Graph Audit, 3. Production Build Verification, 4. Environment Verification Test Matrix, 5. Environment Status Summary, Retrieva AI — Environment Verification Report

### Community 137 - "Retrieva AI — Frontend Testing Report"
Cohesion: 0.22
Nodes (8): 1. Page-by-Page Verification Matrix, 2.1 PDF Rendering & Bounding-Box Alignment, 2.2 Mathematical Formula & Structured Table Rendering, 2.3 Error and Loading States, 2. Deep Subsystem UI Verifications, 3. Mock Data & Demo Fallback Identification Audit, 4. Frontend Status Summary, Retrieva AI — Frontend Testing Report

### Community 138 - "Option10"
Cohesion: 0.25
Nodes (3): AdjustData, CompressObjectStream, Option10

### Community 142 - "updateXFA"
Cohesion: 0.29
Nodes (5): DatasetReader, decodeString(), parseXFAPath(), stringToUTF8String(), updateXFA()

### Community 147 - "3. Complete Step-by-Step User Workflow"
Cohesion: 0.25
Nodes (8): 3. Complete Step-by-Step User Workflow, Step 1: Batch Upload (`/upload`), Step 2: Automated Pipeline Processing (Behind the Scenes), Step 3: Library Management (`/library`), Step 4: Cross-Document Intelligent Search (`/search`), Step 5: Evidence Synthesis & Consensus Analysis, Step 6: Interactive 2D Bounding Box Canvas Viewer (`/viewer`), Step 7: Live Real-File Dashboard (`/dashboard`)

### Community 151 - ".isUsable"
Cohesion: 0.29
Nodes (4): fetchSync(), getUint8ArrayMemory0(), __wbg_finalize_init(), __wbg_get_imports()

### Community 153 - "Endpoints Summary"
Cohesion: 0.33
Nodes (5): 1. Health Discovery, 2. Document Repository, 3. Multi-Modal Spatial Search, Endpoints Summary, Retrieva AI — REST API Specification

### Community 154 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 155 - "createValidAbsoluteUrl"
Cohesion: 0.33
Nodes (4): A, createValidAbsoluteUrl(), fixURL(), recoverJsURL()

### Community 159 - "searchNode"
Cohesion: 0.33
Nodes (5): createDataNode(), makeMap(), parseExpression(), parseIndex(), searchNode()

### Community 164 - "7. Quickstart & Reproduction Guide"
Cohesion: 0.33
Nodes (6): 7.1 Clone and Setup in One Step, 7.2 Run the Development Stack, 7.3 Run All Automated Tests, 7.4 Run the Frozen Acceptance Benchmark, 7. Quickstart & Reproduction Guide, Prerequisites

### Community 165 - "vercel.json"
Cohesion: 0.33
Nodes (5): buildCommand, framework, outputDirectory, rewrites, $schema

### Community 167 - "Retrieva AI — Architecture Documentation"
Cohesion: 0.40
Nodes (4): 1. System Architecture Overview, 2. Configuration Version Invariant, 3. O3 Provenance, Multi-Signal Confidence & Degraded Routing, Retrieva AI — Architecture Documentation

### Community 174 - "Retrieva AI — Backend Testing Report"
Cohesion: 0.40
Nodes (4): 1. Backend Subsystem Verification Overview, 2. Backend Test Execution Matrix, 3. Backend Test Status Summary, Retrieva AI — Backend Testing Report

### Community 176 - "Retrieva AI — Data Repository"
Cohesion: 0.50
Nodes (3): Dataset Guidelines, Directory Structure, Retrieva AI — Data Repository

### Community 178 - "3. Document Management Endpoints"
Cohesion: 0.50
Nodes (4): 3.1 List Documents, 3.2 Get Document Detail, 3.4 Get Page Layout Segments & Provenance, 3. Document Management Endpoints

### Community 179 - "3. Operational Health Monitoring (`/api/v1/health`)"
Cohesion: 0.50
Nodes (4): 3.1 Endpoint Specification, 3.2 Metrics Payload, 3.3 Key Health Indicators, 3. Operational Health Monitoring (`/api/v1/health`)

### Community 196 - "Retrieva AI — Negative Testing Report (NT1 – NT5)"
Cohesion: 0.50
Nodes (3): 1. Executive Summary, 3. Negative Anomaly Telemetry Summary, Retrieva AI — Negative Testing Report (NT1 – NT5)

## Knowledge Gaps
- **1 isolated node(s):** `retrieva-ai`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1626 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **112 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `isDemoMode()` connect `App.jsx` to `NegativeAnomalyRecord`?**
  _High betweenness centrality (0.356) - this node is a cross-community bridge._
- **What connects `retrieva-ai` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pdf.worker.min.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.012511899904800762 - nodes in this community are weakly interconnected._
- **Should `run_acceptance.py` be split into smaller, more focused modules?**
  _Cohesion score 0.045361875637105 - nodes in this community are weakly interconnected._
- **Should `App.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0514018691588785 - nodes in this community are weakly interconnected._
- **Should `test_retrieval.py` be split into smaller, more focused modules?**
  _Cohesion score 0.03706245710363761 - nodes in this community are weakly interconnected._
- **Should `TemplateNamespace` be split into smaller, more focused modules?**
  _Cohesion score 0.02247191011235955 - nodes in this community are weakly interconnected._