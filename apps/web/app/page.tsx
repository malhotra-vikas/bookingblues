export default function Page(): JSX.Element {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '2.5rem', margin: 0 }}>BookingBlues</h1>
      <p style={{ marginTop: '1rem', maxWidth: 480, color: '#444' }}>
        Never miss a job. We turn missed calls into booked appointments for blue-collar service
        businesses.
      </p>
      <p style={{ marginTop: '2rem', color: '#888', fontSize: '0.875rem' }}>
        Coming soon.
      </p>
    </main>
  );
}
