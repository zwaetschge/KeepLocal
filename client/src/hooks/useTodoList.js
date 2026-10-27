import {newLocalId} from '../utils/localId.mjs';
import { useState, useCallback } from 'react';
import {normalizeChecklist,toggleChecklist} from '../utils/checklist.mjs';

/**
 * Hook for managing todo list items
 * Handles adding, updating, toggling, and deleting todo items
 *
 * @param {Array} initialItems - Initial todo items
 * @returns {Object} Todo list state and handlers
 *
 * @example
 * const {
 *   todoItems,
 *   addItem,
 *   updateItemText,
 *   toggleItem,
 *   deleteItem,
 *   setTodoItems
 * } = useTodoList(note?.todoItems || []);
 */
export function useTodoList(initialItems = []) {
  const [todoItems, setTodoItems] = useState(() => normalizeChecklist(initialItems));

  /**
   * Add a new empty todo item
   */
  const addItem = useCallback(() => {
    setTodoItems((prev) => [
      ...prev,
      { id: newLocalId(), text: '', completed: false, order: prev.length, indent:0 },
    ]);
  }, []);

  /**
   * Update the text of a todo item
   * @param {number} index - Item index
   * @param {string} text - New text
   */
  const updateItemText = useCallback((index, text) => {
    setTodoItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], text };
      return updated;
    });
  }, []);

  /**
   * Toggle the completed status of a todo item
   * @param {number} index - Item index
   */
  const toggleItem = useCallback((index) => {
    setTodoItems(prev => toggleChecklist(prev,index));
  }, []);

  /**
   * Delete a todo item and reorder remaining items
   * @param {number} index - Item index to delete
   */
  const deleteItem = useCallback((index) => {
    setTodoItems((prev) => {
      const filtered = prev.filter((_, i) => i !== index);
      // Reorder remaining items
      return filtered.map((item, i) => ({ ...item, order: i }));
    });
  }, []);

  /**
   * Handle keyboard shortcuts for todo items
   * - Enter: Add new item
   * - Backspace: Delete empty item (if more than 1 item exists)
   *
   * @param {KeyboardEvent} e - Keyboard event
   * @param {number} index - Current item index
   */
  const handleItemKeyDown = useCallback(
    (e, index) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addItem();
      } else if (
        e.key === 'Backspace' &&
        !todoItems[index]?.text &&
        todoItems.length > 1
      ) {
        e.preventDefault();
        deleteItem(index);
      }
    },
    [addItem, deleteItem, todoItems]
  );

  /**
   * Convert content text to todo items (when switching modes)
   * @param {string} content - Text content to convert
   */
  const convertFromContent = useCallback((content) => {
    if (content.trim()) {
      const lines = content.split('\n').filter((line) => line.trim());
      const items = lines.map((line, index) => ({
        id: newLocalId(),
        indent: 0,
        text: line.trim(),
        completed: false,
        order: index,
      }));
      setTodoItems(items);
    } else {
      // Start with one empty item
      setTodoItems([{ text: '', completed: false, order: 0 }]);
    }
  }, []);

  /**
   * Convert todo items to plain text content (when switching modes)
   * @returns {string} Plain text representation of todo items
   */
  const convertToContent = useCallback(() => {
    return todoItems.map((item) => item.text).join('\n');
  }, [todoItems]);

  /**
   * Get cleaned todo items for saving (remove empty items, ensure order)
   * @returns {Array} Cleaned todo items
   */
  const getCleanedItems = useCallback(() => {
    return todoItems
      .filter((item) => item.text.trim())
      .map((item, index) => ({
        id: item.id || item._id || newLocalId(),
        indent: item.indent || 0,
        text: item.text.trim(),
        completed: item.completed || false,
        order: index,
      }));
  }, [todoItems]);

  return {
    todoItems,
    setTodoItems,
    addItem,
    updateItemText,
    toggleItem,
    deleteItem,
    handleItemKeyDown,
    convertFromContent,
    convertToContent,
    getCleanedItems,
  };
}

export default useTodoList;
