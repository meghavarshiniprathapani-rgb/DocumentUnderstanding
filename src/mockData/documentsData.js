// Mock Data & Search Service for DocuSense Document Intelligence System

export const MOCK_OVERVIEW_METRICS = {
  totalDocuments: "24",
  pagesProcessed: "1,248",
  searchQueries: "156",
  indexedRegions: "8,420",
  isSampleData: true
};

export const MOCK_SYSTEM_METRICS = {
  totalDocuments: 24,
  totalPagesProcessed: 1248,
  extractedTables: 412,
  extractedFigures: 289,
  averageParsingAccuracy: 98.2,
  vectorIndexSize: "1.42 GB",
  avgQueryLatencyMs: 38,
  capstoneProject: {
    title: "Document Understanding for Retrieval",
    institution: "Retrieva AI Platform",
    department: "Computer Science & Engineering",
    year: "2026"
  }
};

export const MOCK_DOCUMENTS = [
  {
    id: "doc-001",
    title: "Annual Financial Report.pdf",
    fileType: "PDF Document",
    category: "Financial",
    uploadedAt: "2026-09-20",
    fileSize: "4.8 MB",
    pagesCount: 42,
    status: "Processed",
    parsingAccuracy: 98.4,
    tags: ["Financials", "Q4", "Enterprise", "Balance Sheet"],
    summary: "Comprehensive annual earnings report detailing revenue growth, operational expenses, product line performance, and balance sheet metrics across global divisions.",
    metrics: {
      textBlocks: 142,
      tables: 8,
      figures: 6,
      headings: 12
    },
    pages: [
      {
        pageNumber: 1,
        width: 800,
        height: 1100,
        segments: [
          {
            id: "seg-101",
            type: "heading",
            label: "Document Title",
            confidence: 0.99,
            bbox: { x: 50, y: 60, width: 700, height: 45 },
            text: "ANNUAL FINANCIAL REPORT & BALANCES",
            page: 1
          },
          {
            id: "seg-102",
            type: "text",
            label: "Executive Summary",
            confidence: 0.97,
            bbox: { x: 50, y: 120, width: 700, height: 110 },
            text: "During the fiscal year 2025, consolidated revenue expanded by 18.4% year-over-year to $412.5M. Growth was driven primarily by cloud enterprise solutions and high-margin subscription models.",
            page: 1
          },
          {
            id: "seg-103",
            type: "table",
            label: "Revenue Breakdown Table",
            confidence: 0.96,
            bbox: { x: 50, y: 250, width: 700, height: 280 },
            text: "Table 1.1: Consolidated Revenue Breakdown ($ Millions)",
            tableData: {
              headers: ["Segment", "2024 ($M)", "2025 ($M)", "YoY Growth"],
              rows: [
                ["Enterprise Cloud", "142.1", "189.5", "+33.3%"],
                ["SaaS Platform", "88.4", "115.2", "+30.3%"],
                ["Hardware & IoT", "75.0", "68.3", "-8.9%"],
                ["Professional Services", "43.0", "39.5", "-8.1%"]
              ]
            },
            page: 1
          }
        ]
      }
    ]
  },
  {
    id: "doc-002",
    title: "Research Paper on AI.pdf",
    fileType: "PDF Document",
    category: "Academic",
    uploadedAt: "2026-09-21",
    fileSize: "2.3 MB",
    pagesCount: 18,
    status: "Processed",
    parsingAccuracy: 99.1,
    tags: ["AI/ML", "Transformers", "LayoutLM", "Multi-modal"],
    summary: "Academic publication describing multi-modal pre-training for document AI incorporating text, visual features, and spatial bounding box coordinates for structural understanding.",
    metrics: {
      textBlocks: 210,
      tables: 5,
      figures: 11,
      headings: 18
    },
    pages: [
      {
        pageNumber: 1,
        width: 800,
        height: 1100,
        segments: [
          {
            id: "seg-201",
            type: "heading",
            label: "Paper Title",
            confidence: 0.99,
            bbox: { x: 60, y: 70, width: 680, height: 50 },
            text: "LayoutLMv3: Pre-training for Document AI with Visual & Spatial Tokens",
            page: 1
          },
          {
            id: "seg-202",
            type: "text",
            label: "Abstract",
            confidence: 0.98,
            bbox: { x: 60, y: 135, width: 680, height: 120 },
            text: "Abstract: Multi-modal document understanding requires joint modeling of text content, visual cues, and spatial layout structures.",
            page: 1
          }
        ]
      }
    ]
  },
  {
    id: "doc-003",
    title: "Enterprise Policy Document.pdf",
    fileType: "PDF Document",
    category: "Compliance",
    uploadedAt: "2026-09-22",
    fileSize: "3.5 MB",
    pagesCount: 26,
    status: "Processed",
    parsingAccuracy: 97.8,
    tags: ["Policy", "Security", "Governance", "Compliance"],
    summary: "Standard operating procedures and zero-trust data access policies across cloud infrastructure and organizational units.",
    metrics: {
      textBlocks: 340,
      tables: 4,
      figures: 2,
      headings: 28
    },
    pages: []
  }
];

export const MOCK_SEARCH_RESULTS = [
  {
    id: "res-01",
    documentId: "doc-001",
    documentTitle: "Annual Financial Report.pdf",
    pageNumber: 4,
    resultTitle: "Table 1.1: Consolidated Revenue Breakdown & Q3 Financial Results",
    contentType: "Table", // Text, Table, Image, Heading
    relevanceScore: 0.965,
    queryMatchSnippet: "Q3 revenue reached $115.2M with enterprise cloud solutions growing by 33.3% YoY. Operating expenses remained within budget targets.",
    boundingRegion: { x: 50, y: 250, width: 700, height: 280 },
    tableData: {
      headers: ["Segment", "Q3 2024 ($M)", "Q3 2025 ($M)", "YoY Growth"],
      rows: [
        ["Enterprise Cloud", "142.1", "189.5", "+33.3%"],
        ["SaaS Platform", "88.4", "115.2", "+30.3%"]
      ]
    },
    highlights: ["revenue in Q3", "$115.2M", "financial results"]
  },
  {
    id: "res-02",
    documentId: "doc-002",
    documentTitle: "Research Paper on AI.pdf",
    pageNumber: 1,
    resultTitle: "Section 1.2: Project Objectives & Multimodal Benchmark Results",
    contentType: "Heading",
    relevanceScore: 0.942,
    queryMatchSnippet: "The primary project objective is to develop a unified multi-modal spatial transformer architecture capable of aligning visual patches, 2D bounding boxes, and semantic text tokens.",
    boundingRegion: { x: 60, y: 135, width: 680, height: 120 },
    highlights: ["project objectives", "spatial transformer", "visual patches"]
  },
  {
    id: "res-03",
    documentId: "doc-001",
    documentTitle: "Annual Financial Report.pdf",
    pageNumber: 12,
    resultTitle: "Financial Statement: Operating Income & Gross Margin Table",
    contentType: "Table",
    relevanceScore: 0.918,
    queryMatchSnippet: "Gross margins expanded by 240 basis points to 68.2%, driven by automation in technical operations and infrastructure optimization.",
    boundingRegion: { x: 50, y: 300, width: 700, height: 220 },
    tableData: {
      headers: ["Metric", "Q3 2024", "Q3 2025", "Change"],
      rows: [
        ["Gross Margin", "65.8%", "68.2%", "+240 bps"],
        ["Operating Profit", "$42.1M", "$58.4M", "+38.7%"]
      ]
    },
    highlights: ["Gross Margin", "$58.4M", "financial results"]
  },
  {
    id: "res-04",
    documentId: "doc-003",
    documentTitle: "Enterprise Policy Document.pdf",
    pageNumber: 8,
    resultTitle: "Section 4.1: Zero-Trust Network Objectives & Data Governance",
    contentType: "Text",
    relevanceScore: 0.895,
    queryMatchSnippet: "All enterprise microservices must enforce mutual TLS encryption and strict identity verification to satisfy project compliance objectives.",
    boundingRegion: { x: 50, y: 180, width: 700, height: 160 },
    highlights: ["project objectives", "Zero-Trust", "compliance"]
  },
  {
    id: "res-05",
    documentId: "doc-002",
    documentTitle: "Research Paper on AI.pdf",
    pageNumber: 5,
    resultTitle: "Figure 3: LayoutLMv3 Spatial Attention Heatmap Architecture",
    contentType: "Image",
    relevanceScore: 0.874,
    queryMatchSnippet: "Visual attention maps demonstrating spatial grounding over multi-column PDF table structures and visual chart elements.",
    boundingRegion: { x: 60, y: 270, width: 680, height: 320 },
    highlights: ["spatial grounding", "visual chart"]
  }
];

// Mock Search Service Abstraction (Prepares code for future REST backend API calls)
export const mockSearchService = async ({ query, documentFilter, contentType, minScore, pageRange }) => {
  // Simulate network latency delay
  await new Promise(resolve => setTimeout(resolve, 400));

  let results = [...MOCK_SEARCH_RESULTS];

  if (documentFilter && documentFilter !== 'All') {
    results = results.filter(r => r.documentTitle === documentFilter);
  }

  if (contentType && contentType !== 'All') {
    results = results.filter(r => r.contentType.toLowerCase() === contentType.toLowerCase());
  }

  if (minScore) {
    results = results.filter(r => (r.relevanceScore * 100) >= minScore);
  }

  if (query && query.trim() !== '') {
    const qLower = query.toLowerCase();
    results = results.filter(r => 
      r.resultTitle.toLowerCase().includes(qLower) ||
      r.queryMatchSnippet.toLowerCase().includes(qLower) ||
      r.documentTitle.toLowerCase().includes(qLower) ||
      r.contentType.toLowerCase().includes(qLower)
    );
  }

  return results;
};
