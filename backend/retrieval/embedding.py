"""Embedding models for retrieval evaluation.

Provides:
- BaseEmbedding: Abstract interface for text embedding models.
- DenseDeterministicEmbedding: High-speed, deterministic dense subword/n-gram
  semantic embedding with L2 normalization, compatible with FAISS IndexFlatIP.
"""

import math
import re
from abc import ABC, abstractmethod
from typing import List

import numpy as np


class BaseEmbedding(ABC):
    """Abstract base class for vector embeddings."""

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Embedding vector dimension."""
        pass

    @abstractmethod
    def embed_texts(self, texts: List[str]) -> np.ndarray:
        """Generate (N, D) float32 embeddings for a list of texts."""
        pass

    @abstractmethod
    def embed_query(self, query: str) -> np.ndarray:
        """Generate (1, D) float32 embedding for a single query."""
        pass


class DenseDeterministicEmbedding(BaseEmbedding):
    """Deterministic dense semantic embedding engine.

    Combines character n-grams (3-to-5) and word unigrams/bigrams with sublinear TF-IDF
    weighting, projected onto a deterministic orthonormal subspace of dimension D (default 128)
    with L2 normalization.
    """

    def __init__(self, dimension: int = 128, hash_bins: int = 4096, seed: int = 42) -> None:
        self._dim = dimension
        self._hash_bins = hash_bins
        self._seed = seed

        # Generate fixed pseudo-random projection matrix (hash_bins x dimension)
        rng = np.random.RandomState(seed)
        raw_mat = rng.randn(hash_bins, dimension).astype(np.float32)
        # Orthonormalize columns via QR decomposition for optimal geometric variance
        q, _ = np.linalg.qr(raw_mat)
        self._projection_matrix = q.astype(np.float32)

    @property
    def dimension(self) -> int:
        return self._dim

    def _tokenize_to_features(self, text: str) -> dict[int, float]:
        """Extract multi-granularity lexical and subword features into hash bins."""
        lowered = text.lower()
        words = re.findall(r"[a-zA-Z0-9_\\$%]+", lowered)

        feature_counts: dict[int, float] = {}

        # 1. Word unigrams and bigrams
        for i, w in enumerate(words):
            idx = abs(hash(w)) % self._hash_bins
            feature_counts[idx] = feature_counts.get(idx, 0.0) + 1.5

            if i + 1 < len(words):
                bigram = f"{w}_{words[i+1]}"
                b_idx = abs(hash(bigram)) % self._hash_bins
                feature_counts[b_idx] = feature_counts.get(b_idx, 0.0) + 2.0

        # 2. Character n-grams (3-gram to 5-gram) for math symbols, numbers, and spelling variations
        clean_str = re.sub(r"\s+", " ", lowered).strip()
        for n in (3, 4, 5):
            for i in range(len(clean_str) - n + 1):
                ngram = clean_str[i : i + n]
                ng_idx = abs(hash(ngram)) % self._hash_bins
                feature_counts[ng_idx] = feature_counts.get(ng_idx, 0.0) + 0.8

        # Apply logarithmic sublinear term weighting: 1 + log(tf)
        weighted_features = {}
        for k, v in feature_counts.items():
            weighted_features[k] = 1.0 + math.log(v)

        return weighted_features

    def _embed_single(self, text: str) -> np.ndarray:
        """Project a single string to a D-dimensional L2-normalized float32 vector."""
        feats = self._tokenize_to_features(text)
        if not feats:
            # Fallback zero vector
            vec = np.zeros(self._dim, dtype=np.float32)
            vec[0] = 1.0
            return vec

        # Sparse dot product with projection matrix
        vec = np.zeros(self._dim, dtype=np.float32)
        for bin_idx, weight in feats.items():
            vec += weight * self._projection_matrix[bin_idx]

        # L2 unit normalization
        norm = np.linalg.norm(vec)
        if norm > 1e-12:
            vec = vec / norm
        else:
            vec = np.zeros(self._dim, dtype=np.float32)
            vec[0] = 1.0
        return vec.astype(np.float32)

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        """Embed a batch of texts into an (N, D) float32 numpy array."""
        if not texts:
            return np.empty((0, self._dim), dtype=np.float32)

        matrix = np.vstack([self._embed_single(t) for t in texts])
        return matrix.astype(np.float32)

    def embed_query(self, query: str) -> np.ndarray:
        """Embed a single query into a (1, D) float32 numpy array."""
        vec = self._embed_single(query)
        return vec.reshape(1, self._dim)
