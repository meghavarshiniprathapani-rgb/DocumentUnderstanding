export function serializeDocument(doc) {
  if (!doc) return null;

  const metadata = doc.metadata || {};
  const metrics = metadata.metrics || {
    text_blocks: 0,
    tables: 0,
    figures: 0,
    headings: 0
  };

  const defaultCategory = doc.doc_type && doc.doc_type !== 'unclassified'
    ? doc.doc_type.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : 'General Document';

  const defaultAccuracy = doc.status === 'ready' || doc.status === 'processed' ? 98.5 : 0.0;
  const uploadedAtStr = doc.created_at
    ? new Date(doc.created_at).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  return {
    document_id: doc.document_id,
    title: metadata.title || doc.filename,
    filename: doc.filename,
    category: metadata.category || defaultCategory,
    file_size: metadata.file_size || 'N/A',
    pages_count: Number(doc.pages_count) || 1,
    doc_type: doc.doc_type,
    split: doc.split,
    status: doc.status,
    parsing_accuracy: metadata.parsing_accuracy !== undefined ? metadata.parsing_accuracy : defaultAccuracy,
    metrics: {
      text_blocks: Number(metrics.text_blocks) || 0,
      tables: Number(metrics.tables) || 0,
      figures: Number(metrics.figures) || 0,
      headings: Number(metrics.headings) || 0
    },
    uploaded_at: metadata.uploaded_at || uploadedAtStr,
    file_hash: metadata.file_hash || doc.sha256,
    sha256: doc.sha256,
    is_degraded: metadata.is_degraded !== undefined ? Boolean(metadata.is_degraded) : (doc.status === 'degraded'),
    extraction_status: metadata.extraction_status || (doc.status === 'ready' || doc.status === 'processed' ? 'Completed' : (doc.status === 'queued' ? 'Queued' : doc.status)),
    indexing_status: metadata.indexing_status || (doc.status === 'queued' ? 'Pending' : 'Indexed'),
    chunk_count: metadata.chunk_count !== undefined ? Number(metadata.chunk_count) : 0,
    error_details: metadata.error_details || null,
    config_version: '1.0.0'
  };
}

export function serializeElement(elem) {
  if (!elem) return null;

  let bbox = null;
  if (Array.isArray(elem.bbox) && elem.bbox.length === 4) {
    const [x1, y1, x2, y2] = elem.bbox;
    bbox = {
      x: Number(x1),
      y: Number(y1),
      width: Number((x2 - x1).toFixed(2)),
      height: Number((y2 - y1).toFixed(2))
    };
  } else if (elem.bbox && typeof elem.bbox === 'object') {
    const xVal = Number(elem.bbox.x ?? elem.bbox.x_min ?? elem.bbox.x0 ?? 0);
    const yVal = Number(elem.bbox.y ?? elem.bbox.y_min ?? elem.bbox.y0 ?? 0);
    const wVal = Number(
      elem.bbox.width ??
        (elem.bbox.x_max !== undefined
          ? Number(elem.bbox.x_max) - xVal
          : elem.bbox.x1 !== undefined
            ? Number(elem.bbox.x1) - xVal
            : 0)
    );
    const hVal = Number(
      elem.bbox.height ??
        (elem.bbox.y_max !== undefined
          ? Number(elem.bbox.y_max) - yVal
          : elem.bbox.y1 !== undefined
            ? Number(elem.bbox.y1) - yVal
            : 0)
    );
    bbox = {
      x: xVal,
      y: yVal,
      width: Math.max(0, Number.isFinite(wVal) ? Number(wVal.toFixed(2)) : 0),
      height: Math.max(0, Number.isFinite(hVal) ? Number(hVal.toFixed(2)) : 0)
    };
  } else {
    bbox = { x: 0, y: 0, width: 0, height: 0 };
  }

  const type = elem.type || 'text';
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  const elementId = elem.provenance?.element_id || `elem-${elem.id}`;
  const segmentId = elem.provenance?.segment_id || `seg-${elem.page}-${elem.reading_order}`;

  let tableData = null;
  if (elem.structured && typeof elem.structured === 'object') {
    if (elem.structured.headers || elem.structured.rows) {
      tableData = elem.structured;
    }
  }

  let formulaLatex = null;
  if (elem.structured && typeof elem.structured === 'object' && elem.structured.latex) {
    formulaLatex = elem.structured.latex;
  }

  const confidence = Number(elem.confidence !== undefined ? elem.confidence : 1.0);
  const calibratedConfidence = elem.provenance?.calibrated_confidence !== undefined
    ? Number(elem.provenance.calibrated_confidence)
    : confidence;

  const flags = Array.isArray(elem.flags) ? elem.flags : [];
  const isDegraded = flags.includes('is_degraded') || Boolean(elem.provenance?.is_degraded);
  const degradedReasons = elem.provenance?.degraded_reasons || [];

  return {
    id: segmentId,
    element_id: elementId,
    type,
    label,
    page: Number(elem.page),
    reading_order: Number(elem.reading_order),
    text: elem.text || '',
    bbox,
    raw_bbox: elem.bbox || null,
    confidence,
    calibrated_confidence: calibratedConfidence,
    structured: elem.structured || null,
    table_data: tableData,
    formula_latex: formulaLatex,
    provenance: elem.provenance || null,
    flags,
    model_version: elem.model_version || null,
    mode: elem.mode,
    is_degraded: isDegraded,
    degraded_reasons: degradedReasons
  };
}
