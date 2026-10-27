import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
const palette = [
  '#ffffff',
  '#f28b82',
  '#fbbc04',
  '#fff475',
  '#ccff90',
  '#a7ffeb',
  '#cbf0f8',
  '#aecbfa',
  '#d7aefb',
  '#fdcfe8',
  '#e6c9a8',
  '#e8eaed',
];
export default function NotesToolbar({
  filters,
  onFilter,
  tags,
  selectedTag,
  onTag,
  people,
  settings,
  onSettings,
}) {
  const { t } = useLanguage();
  return (
    <div className="notes-toolbar" role="group" aria-label={t('keepFilters')}>
      <select
        aria-label={t('keepType')}
        value={filters.type || ''}
        onChange={(e) => onFilter({ ...filters, type: e.target.value })}
      >
        <option value="">{t('keepAllTypes')}</option>
        {[
          'lists',
          'text',
          'images',
          'reminders',
          'pinned',
          'drawings',
          'audio',
        ].map((type) => (
          <option key={type} value={type}>
            {t(`keepType_${type}`)}
          </option>
        ))}
      </select>
      <select
        aria-label={t('keepTag')}
        value={selectedTag || ''}
        onChange={(e) => onTag(e.target.value || null)}
      >
        <option value="">{t('keepAllTags')}</option>
        {tags.map((tag) => (
          <option key={tag.name || tag} value={tag.name || tag}>
            {tag.name || tag}
          </option>
        ))}
      </select>
      <select
        aria-label={t('keepColor')}
        value={filters.color || ''}
        onChange={(e) => onFilter({ ...filters, color: e.target.value })}
      >
        <option value="">{t('keepAllColors')}</option>
        {palette.map((c, i) => (
          <option key={c} value={c}>
            {t(`keepColor${i}`)}
          </option>
        ))}
      </select>
      <select
        aria-label={t('keepPerson')}
        value={filters.person || ''}
        onChange={(e) => onFilter({ ...filters, person: e.target.value })}
      >
        <option value="">{t('keepAllPeople')}</option>
        {people.map((p) => (
          <option key={p._id || p.id} value={p._id || p.id}>
            {p.username}
          </option>
        ))}
      </select>
      {(Object.values(filters).some(Boolean) || selectedTag) && (
        <button
          onClick={() => {
            onFilter({});
            onTag(null);
          }}
        >
          {t('keepReset')}
        </button>
      )}
      <span className="toolbar-spacer" />
      <button
        aria-pressed={settings.visualStyle === 'keep'}
        onClick={() =>
          onSettings({
            visualStyle: settings.visualStyle === 'keep' ? 'classic' : 'keep',
          })
        }
      >
        {t('keepQuietStyle')}
      </button>
      <button
        aria-label={
          settings.viewMode === 'list' ? t('keepGrid') : t('keepList')
        }
        title={settings.viewMode === 'list' ? t('keepGrid') : t('keepList')}
        onClick={() =>
          onSettings({
            viewMode: settings.viewMode === 'list' ? 'grid' : 'list',
          })
        }
      >
        {settings.viewMode === 'list' ? '▦' : '☰'}
      </button>
    </div>
  );
}
