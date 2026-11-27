import math
import re
import threading
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Set, Tuple

from backend.retrieval.schema import Chunk, RetrievalResult

TOKEN_PATTERN = re.compile(
    r"\\[a-zA-Z]+(?:\{[^{}]*\})+"
    r"|\\[a-zA-Z]+(?:\^[a-zA-Z0-9]+|_[a-zA-Z0-9]+)+"
    r"|\\[a-zA-Z]+"
    r"|[-+]?\d+(?:\.\d+)?%?"
    r"|[a-zA-Z0-9]+(?:&[a-zA-Z0-9]+)+"
    r"|[a-zA-Z0-9]+(?:\^[a-zA-Z0-9]+|_[a-zA-Z0-9]+)+"
    r"|[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)+"
    r"|[a-zA-Z0-9]+"
)

SUB_TOKEN_PATTERN = re.compile(r"\\[a-zA-Z]+|[a-zA-Z0-9]+")


def bm25_tokenize(text: Optional[str]) -> List[str]:
    if not text or not isinstance(text, str):
        return []

    tokens: List[str] = []
    matches = TOKEN_PATTERN.findall(text)
    for tok in matches:
        low = tok.lower()
        tokens.append(low)

        if low.endswith("%") and len(low) > 1:
            no_pct = low[:-1]
            tokens.append(no_pct)
            if no_pct.startswith(("-", "+")) and len(no_pct) > 1:
                tokens.append(no_pct[1:])
        elif low.startswith(("-", "+")) and len(low) > 1:
            tokens.append(low[1:])

        if tok.startswith("\\") and "{" in tok:
            for st in SUB_TOKEN_PATTERN.findall(tok):
                stl = st.lower()
                if stl != low:
                    tokens.append(stl)
        elif "&" in tok or "^" in tok or "_" in tok or "-" in tok:
            for st in SUB_TOKEN_PATTERN.findall(tok):
                stl = st.lower()
                if stl != low and stl not in tokens[-3:]:
                    tokens.append(stl)

    return tokens


class BM25Index:

    def __init__(
        self,
        k1: float = 1.5,
        b: float = 0.75,
        epsilon: float = 0.25,
    ) -> None:
        self.k1 = float(k1)
        self.b = float(b)
        self.epsilon = float(epsilon)
        self._lock = threading.RLock()
        self._chunks: List[Chunk] = []
        self._doc_lens: List[int] = []
        self._doc_source_ids: List[str] = []
        self._doc_chunk_ids: List[str] = []
        self._inverted_index: Dict[str, Dict[int, int]] = defaultdict(dict)
        self._doc_freqs: Dict[str, int] = {}
        self._idf_cache: Dict[str, float] = {}
        self._avg_doc_len: float = 0.0
        self._corpus_size: int = 0

    @property
    def corpus_size(self) -> int:
        with self._lock:
            return self._corpus_size

    def index(self, chunks: List[Chunk]) -> None:
        next_chunks = list(chunks)
        n = len(next_chunks)

        if n == 0:
            with self._lock:
                self._chunks = []
                self._doc_lens = []
                self._doc_source_ids = []
                self._doc_chunk_ids = []
                self._inverted_index = defaultdict(dict)
                self._doc_freqs = {}
                self._idf_cache = {}
                self._avg_doc_len = 0.0
                self._corpus_size = 0
            return

        doc_lens: List[int] = []
        doc_source_ids: List[str] = []
        doc_chunk_ids: List[str] = []
        inverted_index: Dict[str, Dict[int, int]] = defaultdict(dict)
        doc_freqs: Dict[str, int] = defaultdict(int)

        total_tokens = 0
        for doc_idx, chunk in enumerate(next_chunks):
            tokens = bm25_tokenize(chunk.text)
            d_len = len(tokens)
            doc_lens.append(d_len)
            total_tokens += d_len
            doc_source_ids.append(str(chunk.source_doc_id or ""))
            doc_chunk_ids.append(str(chunk.chunk_id or f"chunk_{doc_idx}"))

            counts = Counter(tokens)
            for token, freq in counts.items():
                inverted_index[token][doc_idx] = freq
                doc_freqs[token] += 1

        avg_doc_len = total_tokens / float(n) if n > 0 else 0.0

        idf_cache: Dict[str, float] = {}
        for token, df in doc_freqs.items():
            idf_cache[token] = math.log(1.0 + (float(n) - float(df) + 0.5) / (float(df) + 0.5))

        with self._lock:
            self._chunks = next_chunks
            self._doc_lens = doc_lens
            self._doc_source_ids = doc_source_ids
            self._doc_chunk_ids = doc_chunk_ids
            self._inverted_index = inverted_index
            self._doc_freqs = dict(doc_freqs)
            self._idf_cache = idf_cache
            self._avg_doc_len = avg_doc_len
            self._corpus_size = n

    def score_candidates(
        self,
        query: str,
        document_ids: Optional[List[str]] = None,
    ) -> List[Tuple[Chunk, float]]:
        tokens = bm25_tokenize(query)
        if not tokens:
            return []

        with self._lock:
            if self._corpus_size == 0 or not self._chunks:
                return []

            chunks_snap = list(self._chunks)
            doc_lens_snap = list(self._doc_lens)
            source_ids_snap = list(self._doc_source_ids)
            inv_index_snap = self._inverted_index
            idf_cache_snap = self._idf_cache
            avg_dl = self._avg_doc_len
            k1 = self.k1
            b = self.b

        doc_filter: Optional[Set[str]] = None
        if document_ids:
            doc_filter = {d.strip() for d in document_ids if d and d.strip().lower() != "all"}
            if not doc_filter:
                doc_filter = None

        unique_tokens = Counter(tokens)
        candidate_scores: Dict[int, float] = defaultdict(float)

        for token, q_tf in unique_tokens.items():
            postings = inv_index_snap.get(token)
            if not postings:
                continue
            idf = idf_cache_snap.get(token, 0.0)
            if idf <= 0.0:
                continue

            for doc_idx, tf in postings.items():
                if doc_filter is not None and source_ids_snap[doc_idx] not in doc_filter:
                    continue
                d_len = doc_lens_snap[doc_idx]
                tf_norm = (float(tf) * (k1 + 1.0)) / (
                    float(tf) + k1 * (1.0 - b + b * (float(d_len) / (avg_dl if avg_dl > 0.0 else 1.0)))
                )
                candidate_scores[doc_idx] += float(q_tf) * idf * tf_norm

        if not candidate_scores:
            return []

        ranked_items = sorted(
            candidate_scores.items(),
            key=lambda x: (-x[1], x[0]),
        )

        return [(chunks_snap[idx], score) for idx, score in ranked_items]

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        document_ids: Optional[List[str]] = None,
    ) -> List[RetrievalResult]:
        candidates = self.score_candidates(query=query, document_ids=document_ids)
        if not candidates:
            return []

        results: List[RetrievalResult] = []
        for rank_idx, (chunk, score) in enumerate(candidates[:top_k]):
            results.append(
                RetrievalResult(
                    chunk=chunk,
                    score=round(float(score), 4),
                    rank=rank_idx + 1,
                )
            )
        return results
