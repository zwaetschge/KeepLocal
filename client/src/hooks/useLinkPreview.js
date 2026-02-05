import { useState, useEffect, useRef } from 'react';
import { notesAPI } from '../services/api';

/**
 * Hook for detecting URLs in content and fetching link previews
 * Automatically debounces URL detection to avoid excessive API calls
 *
 * @param {string} content - The text content to scan for URLs
 * @param {boolean} enabled - Whether link preview detection is enabled
 * @param {number} debounceMs - Debounce delay in milliseconds (default: 1000)
 * @returns {Object} { linkPreviews, setLinkPreviews, fetchingPreview }
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
  const fetchingPreviewRef = useRef(fetchingPreview);

  useEffect(() => { linkPreviewsRef.current = linkPreviews; }, [linkPreviews]);
  useEffect(() => { fetchingPreviewRef.current = fetchingPreview; }, [fetchingPreview]);

  useEffect(() => {
    // Don't fetch if disabled or content is empty
    if (!enabled || !content || content.trim() === '') {
      setLinkPreviews([]);
      return;
    }

    // Clear previous timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    // Debounce URL detection
    fetchTimeoutRef.current = setTimeout(() => {
      const urlPattern = /(https?:\/\/[^\s]+)/g;
      const urls = content.match(urlPattern);

      if (urls && urls.length > 0) {
        // Only fetch preview for first URL and if it's not already in linkPreviews
        const firstUrl = urls[0];
        const existingPreview = linkPreviewsRef.current.find((p) => p.url === firstUrl);

        if (!existingPreview && !fetchingPreviewRef.current) {
          setFetchingPreview(true);
          notesAPI
            .fetchLinkPreview(firstUrl)
            .then((preview) => {
              if (mountedRef.current) {
                setLinkPreviews([preview]);
                setFetchingPreview(false);
              }
            })
            .catch((error) => {
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    linkPreviews,
    setLinkPreviews,
    fetchingPreview,
  };
}

export default useLinkPreview;
