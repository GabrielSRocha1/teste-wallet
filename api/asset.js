// Vercel serverless function: proxy do RPC publico da Solana.
// Devolve metadata (getAsset) + supply on-chain (getTokenSupply) numa unica
// chamada. Esses metodos sao bloqueados pelo RPC publico quando o request
// vem de um browser (403) — entao chamamos server-side.
//
// URL: /api/asset?mint={mint}  →  { image, name, symbol, supply, decimals }

const RPC = 'https://api.mainnet-beta.solana.com';

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j && j.result ? j.result : null;
}

module.exports = async (req, res) => {
  const mint = (req.query && req.query.mint) || '';
  if (!mint || !/^[A-Za-z0-9]{32,44}$/.test(mint)) {
    res.status(400).json({ error: 'invalid mint' });
    return;
  }
  try {
    const [asset, sup] = await Promise.all([
      rpc('getAsset',       { id: mint }),
      rpc('getTokenSupply', [mint]),
    ]);
    const c = (asset && asset.content) || {};
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).json({
      image:    (c.links && c.links.image) || (c.files && c.files[0] && c.files[0].uri) || null,
      name:     (c.metadata && c.metadata.name)   || null,
      symbol:   (c.metadata && c.metadata.symbol) || null,
      supply:   (sup && sup.value && typeof sup.value.uiAmount === 'number') ? sup.value.uiAmount : null,
      decimals: (sup && sup.value && typeof sup.value.decimals === 'number') ? sup.value.decimals : null,
    });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
};
