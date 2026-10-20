"use client";

import { forwardRef, useId, useImperativeHandle, useRef, useState } from "react";
import { consumeTagInput, TAG_LENGTH, TAG_LIMIT } from "../shared/praise-tags.mjs";

export type TagInputHandle = { commit: () => string[] | null };
const TagInput = forwardRef<TagInputHandle, { tags: string[]; onChange: (tags: string[]) => void }>(function TagInput({ tags, onChange }, ref) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const compositionEnded = useRef(0);
  const currentTags = useRef(tags);
  currentTags.current = tags;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const apply = (value: string, flush = false) => {
    const result = consumeTagInput(currentTags.current, value, flush);
    currentTags.current = result.tags;
    onChange(result.tags); setDraft(result.input); setError(result.error); setNotice(result.notice);
    if (result.error && flush) field.current?.focus();
    return result.error ? null : result.tags;
  };
  useImperativeHandle(ref, () => ({ commit: () => {
    if (composing.current) { setError("글자 입력을 마친 뒤 저장해 주세요."); field.current?.focus(); return null; }
    return apply(field.current?.value ?? draft, true);
  } }));
  return <div className="tag-editor">
    <label htmlFor={id}>태그 선택 <span className="optional-mark">선택 사항</span></label>
    <ul className="tag-chips selected-tags" aria-label="추가한 태그">{tags.map((tag) => <li key={tag} className="tag-chip"><span>#{tag}</span><button type="button" aria-label={`${tag} 태그 삭제`} onClick={() => { onChange(tags.filter((item) => item !== tag)); setNotice(`${tag} 태그를 삭제했어요.`); setError(""); }}>×</button></li>)}</ul>
    <textarea ref={field} id={id} rows={1} value={draft} className="tag-new-input" placeholder="#태그 입력 후 공백" aria-describedby={`${id}-hint ${id}-status`} aria-invalid={Boolean(error)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => { composing.current = false; compositionEnded.current = Date.now(); apply(event.currentTarget.value); }}
      onChange={(event) => { if (composing.current || (event.nativeEvent as InputEvent).isComposing) { setDraft(event.currentTarget.value); return; } apply(event.currentTarget.value); }}
      onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || Date.now() - compositionEnded.current < 50) return; apply(event.currentTarget.value, true); }} />
    <p id={`${id}-hint`} className="field-hint">#으로 시작해 공백으로 구분해 주세요. 최대 {TAG_LIMIT}개 · 태그당 {TAG_LENGTH}자</p>
    <p id={`${id}-status`} className={error ? "form-error" : "field-hint"} role="status" aria-live="polite">{error || notice}</p>
  </div>;
});
export default TagInput;
