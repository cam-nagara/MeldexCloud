'use strict';

importScripts('gb-portable-knowledge-contract.js');

self.addEventListener('message', (event) => {
  const request = event.data || {};
  try {
    if (request.type === 'extract') {
      const artifact = self.MeldexPortableKnowledgeContract.createArtifact(request.input || {});
      self.postMessage({ id: request.id, ok: true, artifact });
      return;
    }
    if (request.type === 'score') {
      const rows = (request.artifacts || []).map(artifact => ({
        artifact,
        ...self.MeldexPortableKnowledgeContract.scoreArtifact(artifact, request.query || ''),
      })).filter(row => row.score > 0).sort((a, b) => b.score - a.score).slice(0, request.limit || 10);
      self.postMessage({ id: request.id, ok: true, rows });
      return;
    }
    throw new Error('未知の自動ナレッジ処理です');
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: error?.message || String(error) });
  }
});
