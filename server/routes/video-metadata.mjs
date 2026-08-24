// Fetch YouTube video metadata using the public oEmbed + page scraping approach

export async function fetchVideoMetadata(videoId) {
  // Try YouTube oEmbed first (no API key needed)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const resp = await fetch(oembedUrl);
    if (resp.ok) {
      const data = await resp.json();

      // Also try to get more details from the watch page
      const watchHtml = await fetchWatchPage(videoId);

      return {
        videoId,
        title: data.title || 'Unknown Title',
        channel: data.author_name || 'Unknown Channel',
        description: watchHtml.description || '',
        publishDate: watchHtml.publishDate || '',
        lengthSeconds: watchHtml.lengthSeconds || 0,
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        viewCount: watchHtml.viewCount,
      };
    }
  } catch (e) {
    console.error('oEmbed failed, falling back to page scrape:', e);
  }

  // Fallback: scrape from watch page
  const watchHtml = await fetchWatchPage(videoId);
  return {
    videoId,
    title: watchHtml.title || 'Unknown Title',
    channel: watchHtml.channel || 'Unknown Channel',
    description: watchHtml.description || '',
    publishDate: watchHtml.publishDate || '',
    lengthSeconds: watchHtml.lengthSeconds || 0,
    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    viewCount: watchHtml.viewCount,
  };
}

async function fetchWatchPage(videoId) {
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!resp.ok) return {};

    const html = await resp.text();

    // Extract ytInitialPlayerResponse
    let playerData = {};
    try {
      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
      if (playerMatch) playerData = JSON.parse(playerMatch[1]);
    } catch {}

    // Extract ytInitialData (for description, publish date, etc.)
    let ytData = {};
    try {
      const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});/s);
      if (dataMatch) ytData = JSON.parse(dataMatch[1]);
    } catch {}

    const videoDetails = playerData.videoDetails || {};
    const microformat = (playerData.microformat || {}).playerMicroformatRenderer || {};

    // Try to get description from ytInitialData
    let description = '';
    try {
      const attrPath = ((ytData.contents || {}).twoColumnWatchNextResults || {}).results || {};
      const contentRenderer = ((attrPath.results || {}).contents || [])[0] || {};
      const secondaryInfo = contentRenderer.videoSecondaryInfoRenderer || {};
      description = (secondaryInfo.description || {}).runs ? secondaryInfo.description.runs.map(r => r.text).join('') : '';
    } catch {}

    return {
      title: videoDetails.title || (microformat.title || {}).simpleText || '',
      channel: videoDetails.author || '',
      description: description || videoDetails.shortDescription || (microformat.description || {}).simpleText || '',
      publishDate: microformat.publishDate || '',
      lengthSeconds: videoDetails.lengthSeconds ? Number(videoDetails.lengthSeconds) : 0,
      viewCount: videoDetails.viewCount ? Number(videoDetails.viewCount) : null,
    };
  } catch (e) {
    console.error('Watch page scrape failed:', e);
    return {};
  }
}
