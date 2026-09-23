// Mock Data & Search Service for Retrieva Document Intelligence System

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
    title: "Annual Financial Report 2025.pdf",
    fileType: "PDF Document",
    category: "Financial Report",
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
    title: "LayoutLMv3 Multi-Modal Research Paper.pdf",
    fileType: "PDF Document",
    category: "Academic Research Paper",
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
    title: "Enterprise Zero-Trust Security Policy.pdf",
    fileType: "PDF Document",
    category: "Compliance & Policy",
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
  },
  {
    id: "doc-004",
    title: "Transformer Spatial Attention Architecture.pdf",
    fileType: "PDF Document",
    category: "Technical Whitepaper",
    uploadedAt: "2026-09-22",
    fileSize: "5.1 MB",
    pagesCount: 34,
    status: "Processed",
    parsingAccuracy: 98.9,
    tags: ["Architecture", "Attention", "Spatial Embedding", "Whitepaper"],
    summary: "Deep dive into 2D relative spatial position embeddings for transformers parsing multi-column document layouts.",
    metrics: {
      textBlocks: 285,
      tables: 9,
      figures: 14,
      headings: 22
    },
    pages: []
  },
  {
    id: "doc-005",
    title: "Quarterly Cloud Revenue & Operations Report.pdf",
    fileType: "PDF Document",
    category: "Project Report",
    uploadedAt: "2026-09-23",
    fileSize: "3.1 MB",
    pagesCount: 22,
    status: "Processed",
    parsingAccuracy: 99.4,
    tags: ["Operations", "Cloud", "Metrics", "Q3 Report"],
    summary: "Quarterly project performance metrics, server latency stats, vector database index scaling, and revenue allocation breakdown.",
    metrics: {
      textBlocks: 195,
      tables: 6,
      figures: 7,
      headings: 15
    },
    pages: []
  }
];

export const MOCK_SEARCH_RESULTS = [
  {
    id: "res-01",
    documentId: "doc-001",
    documentTitle: "Annual Financial Report 2025.pdf",
    category: "Financial Report",
    pageNumber: 4,
    resultTitle: "Table 1.1: Consolidated Revenue Breakdown & Q3 Financial Results",
    contentType: "Table", // Text, Table, Image, Heading, Chart
    relevanceScore: 0.965,
    queryMatchSnippet: "Q3 revenue reached $115.2M with enterprise cloud solutions growing by 33.3% YoY. Operating expenses remained within budget targets across all product divisions.",
    boundingRegion: { x: 50, y: 250, width: 700, height: 280 },
    tableData: {
      headers: ["Segment", "Q3 2024 ($M)", "Q3 2025 ($M)", "YoY Growth"],
      rows: [
        ["Enterprise Cloud Solutions", "142.1", "189.5", "+33.3%"],
        ["SaaS Document Platform", "88.4", "115.2", "+30.3%"],
        ["Hardware Infrastructure", "75.0", "68.3", "-8.9%"]
      ]
    },
    highlights: ["revenue", "Q3", "$115.2M", "financial results"]
  },
  {
    id: "res-02",
    documentId: "doc-002",
    documentTitle: "LayoutLMv3 Multi-Modal Research Paper.pdf",
    category: "Academic Research Paper",
    pageNumber: 1,
    resultTitle: "Section 1.2: Multi-Modal Document Understanding & Spatial Token Alignment",
    contentType: "Heading",
    relevanceScore: 0.942,
    queryMatchSnippet: "The primary project objective is to develop a unified multi-modal spatial transformer architecture capable of aligning visual patches, 2D bounding box coordinates, and semantic text tokens.",
    boundingRegion: { x: 60, y: 135, width: 680, height: 120 },
    highlights: ["multi-modal", "document understanding", "spatial transformer", "bounding box"]
  },
  {
    id: "res-03",
    documentId: "doc-004",
    documentTitle: "Transformer Spatial Attention Architecture.pdf",
    category: "Technical Whitepaper",
    pageNumber: 7,
    resultTitle: "Figure 4: 2D Relative Spatial Position Embedding Attention Map",
    contentType: "Image",
    relevanceScore: 0.928,
    queryMatchSnippet: "Spatial attention maps demonstrating 2D position embedding alignment across multi-column PDF layouts and complex tabular document structures.",
    boundingRegion: { x: 65, y: 210, width: 670, height: 310 },
    highlights: ["spatial attention", "2D position embedding", "multi-column PDF"]
  },
  {
    id: "res-04",
    documentId: "doc-001",
    documentTitle: "Annual Financial Report 2025.pdf",
    category: "Financial Report",
    pageNumber: 12,
    resultTitle: "Financial Statement: Operating Profit & Gross Margin Breakdown",
    contentType: "Table",
    relevanceScore: 0.918,
    queryMatchSnippet: "Gross margins expanded by 240 basis points to 68.2%, driven by automation in document understanding pipelines and infrastructure optimization.",
    boundingRegion: { x: 50, y: 300, width: 700, height: 220 },
    tableData: {
      headers: ["Financial Metric", "FY 2024", "FY 2025", "Variance"],
      rows: [
        ["Gross Margin %", "65.8%", "68.2%", "+240 bps"],
        ["Operating Profit ($M)", "$42.1M", "$58.4M", "+38.7%"],
        ["R&D AI Allocation", "$18.5M", "$26.2M", "+41.6%"]
      ]
    },
    highlights: ["Gross Margin", "$58.4M", "operating profit", "financial"]
  },
  {
    id: "res-05",
    documentId: "doc-003",
    documentTitle: "Enterprise Zero-Trust Security Policy.pdf",
    category: "Compliance & Policy",
    pageNumber: 8,
    resultTitle: "Section 4.1: Zero-Trust Identity Verification & Data Governance Standard",
    contentType: "Text",
    relevanceScore: 0.895,
    queryMatchSnippet: "All enterprise microservices and document retrieval endpoints must enforce mutual TLS encryption and strict identity verification to satisfy project compliance and zero-trust standards.",
    boundingRegion: { x: 50, y: 180, width: 700, height: 160 },
    highlights: ["Zero-Trust", "identity verification", "compliance", "retrieval endpoints"]
  },
  {
    id: "res-06",
    documentId: "doc-005",
    documentTitle: "Quarterly Cloud Revenue & Operations Report.pdf",
    category: "Project Report",
    pageNumber: 3,
    resultTitle: "Operational Performance: Vector Database Indexing Latency",
    contentType: "Text",
    relevanceScore: 0.876,
    queryMatchSnippet: "Average query execution latency across the HNSW vector database cluster averaged 38ms per semantic search request, maintaining 99.8% uptime.",
    boundingRegion: { x: 55, y: 140, width: 690, height: 150 },
    highlights: ["query execution latency", "vector database", "semantic search"]
  },
  {
    id: "res-07",
    documentId: "doc-002",
    documentTitle: "LayoutLMv3 Multi-Modal Research Paper.pdf",
    category: "Academic Research Paper",
    pageNumber: 14,
    resultTitle: "Table 4: Benchmark Comparison on FUNSD and CORD Datasets",
    contentType: "Table",
    relevanceScore: 0.852,
    queryMatchSnippet: "LayoutLMv3 achieves state-of-the-art F1 score of 92.4% on FUNSD form understanding benchmark and 97.1% on CORD receipt parsing dataset.",
    boundingRegion: { x: 60, y: 320, width: 680, height: 260 },
    tableData: {
      headers: ["Model Architecture", "FUNSD F1 (%)", "CORD F1 (%)", "DocVQA ANLS"],
      rows: [
        ["LayoutLMv1", "79.2%", "94.7%", "69.8%"],
        ["LayoutLMv2", "84.2%", "94.9%", "78.1%"],
        ["LayoutLMv3 (Proposed)", "92.4%", "97.1%", "83.4%"]
      ]
    },
    highlights: ["LayoutLMv3", "FUNSD", "form understanding", "F1 score"]
  },
  {
    id: "res-08",
    documentId: "doc-005",
    documentTitle: "Quarterly Cloud Revenue & Operations Report.pdf",
    category: "Project Report",
    pageNumber: 11,
    resultTitle: "Chart 2.3: Multi-modal Spatial Search Latency vs Document Density",
    contentType: "Chart",
    relevanceScore: 0.824,
    queryMatchSnippet: "Benchmark visualization showing sub-50ms response times for complex multi-column spatial retrieval queries up to 10,000 indexed bounding box regions.",
    boundingRegion: { x: 55, y: 280, width: 690, height: 300 },
    highlights: ["spatial search", "latency", "bounding box regions"]
  }
];

// Mock Search Service Abstraction (Prepares code for future REST backend API calls)
export const mockSearchService = async ({ query, documentFilter, contentType, minScore, pageRange }) => {
  // Simulate network latency delay
  await new Promise(resolve => setTimeout(resolve, 450));

  let results = [...MOCK_SEARCH_RESULTS];

  // Document Filter
  if (documentFilter && documentFilter !== 'All') {
    results = results.filter(r => r.documentTitle.toLowerCase().includes(documentFilter.toLowerCase()));
  }

  // Content Type Filter
  if (contentType && contentType !== 'All') {
    results = results.filter(r => r.contentType.toLowerCase() === contentType.toLowerCase());
  }

  // Relevance Score Filter
  if (minScore) {
    results = results.filter(r => (r.relevanceScore * 100) >= minScore);
  }

  // Page Range Filter
  if (pageRange && pageRange.trim() !== '' && pageRange.toLowerCase() !== 'all') {
    const rangeParts = pageRange.split('-').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p));
    if (rangeParts.length === 1) {
      results = results.filter(r => r.pageNumber === rangeParts[0]);
    } else if (rangeParts.length >= 2) {
      results = results.filter(r => r.pageNumber >= rangeParts[0] && r.pageNumber <= rangeParts[1]);
    }
  }

  // Query String Text Matching
  if (query && query.trim() !== '') {
    const qLower = query.toLowerCase().trim();
    // Smart tokenized search
    const queryTokens = qLower.split(' ').filter(t => t.length > 2);

    const matchedResults = results.filter(r => {
      const targetText = (r.resultTitle + " " + r.queryMatchSnippet + " " + r.documentTitle + " " + r.contentType + " " + (r.highlights ? r.highlights.join(' ') : '')).toLowerCase();
      
      if (targetText.includes(qLower)) return true;
      return queryTokens.some(token => targetText.includes(token));
    });

    // If query was typed but no specific match tokens, return standard top results to demonstrate prototype
    return matchedResults.length > 0 ? matchedResults : results.slice(0, 3);
  }

  return results;
};
