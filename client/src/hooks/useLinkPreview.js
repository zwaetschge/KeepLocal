import { useState, useEffect, useRef, useCallback } from 'react';
import { notesAPI } from '../services/api';

/**
 * Hook for detecting URLs in content and fetching link previews
 * Automatically debounces URL detection to avoid excessive API calls
 *
 * @param {string} content - The text content to scan for URLs
 * @param {boolean} enabled - Whether link preview detection is enabled
 * @param {number} debounceMs - Debounce delay in milliseconds (default: 1000)
 * @returns {Object} { linkPreviews, setLinkPreviews, removeLinkPreview, fetchingPreview }
 *
 * @example
 * const { linkPreviews, fetchingPreview } = useLinkPreview(noteContent, !isTodoList);
 */
export function useLinkPreview(content, enabled = true, debounceMs = 1000) {
  const [linkPreviews, setLinkPreviews] = useState([]);
  const [fetchingPreview, setFetchingPreview] = useState(false);
  const fetchTimeoutRef = useRef(null);
  const mountedRef = useRef(true);
  // Use refs to read current state inside the debounced callback without
  // adding them as dependencies (which would reset the debounce timer on every state change)
  const linkPreviewsRef = useRef(linkPreviews);
  const contentRef = useRef(content);
  // URL currently being fetched, so a different URL may start a new fetch
  const fetchingUrlRef = useRef(null);
  // Previews the user dismissed with the X button — never auto-resurrect them
  const dismissedUrlsRef = useRef(new Set());
  // Previews parked while the hook was disabled (todo mode) — restored on
  // re-enable instead of refetching (which could fail and wipe the saved data)
  const parkedPreviewsRef = useRef([]);

  useEffect(() => { linkPreviewsRef.current = linkPreviews; }, [linkPreviews]);
  useEffect(() => { contentRef.current = content; }, [content]);

  useEffect(() => {
    // Don't fetch if disabled or content is empty; park existing previews so
    // toggling note -> todo -> note does not lose them.
    if (!enabled || !content || content.trim() === '') {
      setLinkPreviews((prev) => {
        if (prev.length > 0) {
          parkedPreviewsRef.current = prev;
        }
        return [];
      });
      return;
    }

    // Clear previous timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    // Debounce URL detection
    fetchTimeoutRef.current = setTimeout(() => {
      const urlPattern = /(https?:\/\/[^\s]+)/g;
      const urls = contentRef.current ? contentRef.current.match(urlPattern) : null;

      if (urls && urls.length > 0) {
        // Restore previews parked while the hook was disabled, as long as
        // their URLs are still part of the content.
        if (parkedPreviewsRef.current.length > 0) {
          const restored = parkedPreviewsRef.current.filter((p) => urls.includes(p.url));
          parkedPreviewsRef.current = [];
          if (restored.length > 0) {
            setLinkPreviews((prev) => {
              const known = new Set(prev.map((p) => p.url));
              return [...prev, ...restored.filter((p) => !known.has(p.url))];
            });
          }
        }

        // Forget dismissals for URLs that are no longer in the content, so
        // deliberately re-adding a URL later fetches its preview again.
        const urlSet = new Set(urls);
        for (const url of dismissedUrlsRef.current) {
          if (!urlSet.has(url)) {
            dismissedUrlsRef.current.delete(url);
          }
        }

        const firstUrl = urls[0];
        const existingPreview = linkPreviewsRef.current.find((p) => p.url === firstUrl);

        if (!existingPreview && !dismissedUrlsRef.current.has(firstUrl) && fetchingUrlRef.current !== firstUrl) {
          fetchingUrlRef.current = firstUrl;
          setFetchingPreview(true);
          notesAPI
            .fetchLinkPreview(firstUrl)
            .then((preview) => {
              fetchingUrlRef.current = null;
              if (!mountedRef.current) return;
              setFetchingPreview(false);
              // The content may have changed while the request was in flight;
              // only keep the result if this URL is still (one of) the URL(s)
              // in the current content, and keep previews for other URLs that
              // are still present instead of replacing the whole list.
              const currentUrls = contentRef.current
                ? contentRef.current.match(urlPattern) || []
                : [];
              if (currentUrls.includes(firstUrl)) {
                setLinkPreviews((prev) => [
                  ...prev.filter((p) => currentUrls.includes(p.url) && p.url !== firstUrl),
                  preview,
                ]);
              }
            })
            .catch((error) => {
              fetchingUrlRef.current = null;
              console.error('Failed to fetch link preview:', error);
              if (mountedRef.current) {
                setFetchingPreview(false);
              }
            });
        }
      } else {
        // No URLs found, clear previews
        setLinkPreviews([]);
      }
    }, debounceMs);

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [content, enabled, debounceMs]);

  // Remove a preview and remember the dismissal so typing does not resurrect it
  const removeLinkPreview = useCallback((url) => {
    dismissedUrlsRef.current.add(url);
    setLinkPreviews((prev) => prev.filter((p) => p.url !== url));
  }, []);

  // Cleanup on unmount. The mount half matters: React 18 StrictMode (dev) runs
  // mount → cleanup → mount, so without resetting the flag the hook stays
  // "unmounted" forever and every fetched preview is silently dropped.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    linkPreviews,
    setLinkPreviews,
    removeLinkPreview,
    fetchingPreview,
  };
}

export default useLinkPreview;
