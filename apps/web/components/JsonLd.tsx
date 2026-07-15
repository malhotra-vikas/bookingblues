/**
 * Renders a JSON-LD structured-data <script>. `data` is a schema.org object.
 * Server-rendered so crawlers see it in the initial HTML.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }): JSX.Element {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe here (our own data, no user input).
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
