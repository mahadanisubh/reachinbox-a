import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Sender } from '../types';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { useToast } from './Toast';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function parseEmails(text: string): string[] {
  const found = text.match(EMAIL_RE) ?? [];
  return Array.from(new Set(found.map((e) => e.toLowerCase())));
}

function defaultStartTime(): string {
  const d = new Date(Date.now() + 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

interface Errors {
  sender?: string;
  subject?: string;
  body?: string;
  recipients?: string;
  startTime?: string;
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V4m0 0 4 4m-4-4L8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ComposeModal({ open, onClose, onScheduled }: Props) {
  const { notify } = useToast();
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [leadsText, setLeadsText] = useState('');
  const [startTime, setStartTime] = useState(defaultStartTime());
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const [addingSender, setAddingSender] = useState(false);
  const [newSenderName, setNewSenderName] = useState('');
  const [savingSender, setSavingSender] = useState(false);

  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const recipients = useMemo(() => parseEmails(leadsText), [leadsText]);
  const selectedSender = useMemo(
    () => senders.find((s) => s.id === senderId) ?? null,
    [senders, senderId],
  );

  const startIso = useMemo(() => {
    const d = new Date(startTime);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }, [startTime]);

  const loadSenders = useCallback(async () => {
    try {
      const list = await api.senders();
      setSenders(list);
      setSenderId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ''));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  }, [notify]);

  useEffect(() => {
    if (!open) return;
    setStartTime(defaultStartTime());
    void loadSenders();
  }, [open, loadSenders]);

  const handleFiles = async (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (!file) return;
    const text = await file.text();
    setLeadsText((prev) => (prev ? `${prev}\n${text}` : text));
    setErrors((e) => ({ ...e, recipients: undefined }));
  };

  const confirmAddSender = async () => {
    const name = newSenderName.trim();
    if (!name) return;
    setSavingSender(true);
    try {
      const created = await api.createSender({ name });
      await loadSenders();
      setSenderId(created.id);
      setNewSenderName('');
      setAddingSender(false);
      notify(`Sender "${created.name}" created`, 'success');
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Failed to create sender', 'error');
    } finally {
      setSavingSender(false);
    }
  };

  const submit = async () => {
    const next: Errors = {};
    if (!senderId) next.sender = 'Choose a sender';
    if (!subject.trim()) next.subject = 'Add a subject';
    if (!body.trim()) next.body = 'Add a message';
    if (recipients.length === 0) next.recipients = 'Add at least one recipient';
    if (!startIso) next.startTime = 'Pick a valid start time';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const res = await api.schedule({
        senderId,
        subject: subject.trim(),
        body,
        recipients,
        startTime: startIso!,
        delaySeconds,
        hourlyLimit: hourlyLimit === '' ? undefined : Number(hourlyLimit),
      });
      notify(
        `Scheduled ${res.scheduled} email(s)` +
          (res.duplicatesSkipped ? `, ${res.duplicatesSkipped} duplicate(s) skipped` : ''),
        'success',
      );
      onScheduled();
      onClose();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Failed to schedule emails', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const summary = [
    `${recipients.length.toLocaleString()} recipient${recipients.length === 1 ? '' : 's'}`,
    selectedSender ? `from ${selectedSender.name}` : null,
    startIso ? `starting ${formatDateTime(startIso)}` : null,
    `1 email every ${delaySeconds}s`,
    hourlyLimit ? `up to ${hourlyLimit}/hour` : null,
  ].filter(Boolean);

  return (
    <Modal
      open={open}
      size="lg"
      title="Compose new email"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            {recipients.length > 0
              ? `Schedule ${recipients.length.toLocaleString()} email${recipients.length === 1 ? '' : 's'}`
              : 'Schedule'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Sender */}
        <div>
          <Field label="Sender" error={errors.sender}>
            <div className="flex items-center gap-2">
              <Select
                value={senderId}
                invalid={Boolean(errors.sender)}
                onChange={(e) => {
                  setSenderId(e.target.value);
                  setErrors((x) => ({ ...x, sender: undefined }));
                }}
              >
                {senders.length === 0 && <option value="">No senders available</option>}
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.email}
                  </option>
                ))}
              </Select>
              {!addingSender && (
                <Button variant="secondary" size="sm" onClick={() => setAddingSender(true)}>
                  New
                </Button>
              )}
            </div>
          </Field>

          {addingSender && (
            <div className="mt-2 flex items-center gap-2">
              <Input
                autoFocus
                value={newSenderName}
                placeholder="New sender name"
                onChange={(e) => setNewSenderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmAddSender();
                  if (e.key === 'Escape') setAddingSender(false);
                }}
              />
              <Button size="sm" onClick={confirmAddSender} loading={savingSender}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingSender(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        <div className="h-px bg-slate-100" />

        {/* Message */}
        <Field label="Subject" error={errors.subject}>
          <Input
            value={subject}
            invalid={Boolean(errors.subject)}
            placeholder="Quick intro to your team"
            onChange={(e) => {
              setSubject(e.target.value);
              setErrors((x) => ({ ...x, subject: undefined }));
            }}
          />
        </Field>

        <Field label="Message" error={errors.body}>
          <Textarea
            value={body}
            invalid={Boolean(errors.body)}
            placeholder="Hi there, I wanted to reach out because…"
            onChange={(e) => {
              setBody(e.target.value);
              setErrors((x) => ({ ...x, body: undefined }));
            }}
          />
        </Field>

        <div className="h-px bg-slate-100" />

        {/* Recipients */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Recipients</span>
            <span
              className={`text-xs font-medium tnum ${
                recipients.length > 0 ? 'text-brand' : 'text-slate-500'
              }`}
            >
              {recipients.length.toLocaleString()} detected
            </span>
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
              dragOver
                ? 'border-brand bg-rose-50 text-brand'
                : errors.recipients
                  ? 'border-red-400 bg-white text-slate-500'
                  : 'border-slate-300 bg-slate-50/60 text-slate-500 hover:border-slate-400 hover:bg-slate-50'
            }`}
          >
            <span className="text-slate-400">
              <UploadIcon />
            </span>
            <span className="text-sm">
              <span className="font-medium text-slate-800">Click to upload</span> or drag a CSV / TXT
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />

          <Textarea
            className="min-h-[72px]"
            value={leadsText}
            invalid={Boolean(errors.recipients)}
            placeholder="…or paste emails (comma, semicolon or newline separated)"
            onChange={(e) => {
              setLeadsText(e.target.value);
              setErrors((x) => ({ ...x, recipients: undefined }));
            }}
          />
          {errors.recipients && (
            <p className="text-xs font-medium text-red-600">{errors.recipients}</p>
          )}

          {recipients.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {recipients.slice(0, 8).map((email) => (
                <span
                  key={email}
                  className="max-w-full truncate rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                >
                  {email}
                </span>
              ))}
              {recipients.length > 8 && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  +{(recipients.length - 8).toLocaleString()} more
                </span>
              )}
            </div>
          )}
        </div>

        <div className="h-px bg-slate-100" />

        {/* Scheduling */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Start time" error={errors.startTime}>
            <Input
              type="datetime-local"
              value={startTime}
              invalid={Boolean(errors.startTime)}
              onChange={(e) => {
                setStartTime(e.target.value);
                setErrors((x) => ({ ...x, startTime: undefined }));
              }}
            />
          </Field>
          <Field label="Delay between sends" hint="Seconds">
            <Input
              type="number"
              min={0}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
          <Field label="Hourly limit" hint="Defaults to sender's cap">
            <Input
              type="number"
              min={1}
              placeholder="default"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </Field>
        </div>

        {/* Live summary */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {summary.join(' · ')}
        </div>
      </div>
    </Modal>
  );
}

export default ComposeModal;