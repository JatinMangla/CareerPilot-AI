import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] grid place-items-center p-4">
      <div className="card-pad max-w-md space-y-3 text-center">
        <h1 className="h2">This page doesn&apos;t exist</h1>
        <p className="text-sm text-ink-300">The link may be old, or the page may have moved.</p>
        <Link className="btn-primary" href="/">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
