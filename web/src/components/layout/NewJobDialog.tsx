import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useInvalidateAll } from "@/lib/queries";
import { useToast } from "@/lib/toast";
import { useUi } from "@/lib/ui-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/overlay";

export function NewJobDialog() {
  const { newJobOpen, setNewJobOpen } = useUi();
  return (
    <Dialog open={newJobOpen} onOpenChange={setNewJobOpen}>
      {newJobOpen && <NewJobForm onDone={() => setNewJobOpen(false)} />}
    </Dialog>
  );
}

function NewJobForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const toast = useToast();

  const create = useMutation({
    mutationFn: api.createJob,
    onSuccess: async (job) => {
      await invalidate();
      toast("Job added. Scoring in the background.");
      onDone();
      navigate(`/jobs?job=${job.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() && !description.trim()) {
      setError("Paste a job description or a URL to continue.");
      return;
    }
    setError(null);
    create.mutate({
      url: url.trim() || undefined,
      description: description.trim() || undefined,
      company: company.trim() || undefined,
      title: title.trim() || undefined,
    });
  }

  return (
    <DialogContent
      title="Add a job"
      description="Paste a job description or a link. It gets scored against your resume right away."
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-job-form" disabled={create.isPending}>
            {create.isPending ? "Adding..." : "Add and score"}
          </Button>
        </>
      }
    >
      <form id="new-job-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Job URL" hint="Greenhouse, Lever and Ashby links are read automatically.">
          {(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://boards.greenhouse.io/..." inputMode="url" autoFocus />}
        </Field>
        <Field label="Job description" hint="Needed when the link is not a known board.">
          {(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="Paste the full text of the posting" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company (optional)">{(id) => <Input id={id} value={company} onChange={(e) => setCompany(e.target.value)} />}</Field>
          <Field label="Title (optional)">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </form>
    </DialogContent>
  );
}
