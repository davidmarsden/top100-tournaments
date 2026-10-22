function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

// How to install the Top 100 app and switch on notifications. Hidden once the
// app is already running from the home screen.
export default function Top100AppGuide({ signedIn = false }) {
  if (isStandalone()) return null;
  const ios = isIos();

  const installSteps = [
    { key: 'ios', label: 'iPhone or iPad', text: <>In <b>Safari</b>, tap <b>Share</b>, then <b>Add to Home Screen</b>.</> },
    { key: 'android', label: 'Android', text: <>In <b>Chrome</b>, tap the <b>⋮</b> menu, then <b>Install app</b> or <b>Add to Home screen</b>.</> },
  ];
  // Show the visitor's own platform first.
  if (!ios) installSteps.reverse();

  return (
    <section className="top100-app-guide" aria-labelledby="top100-app-guide-heading">
      <p className="eyebrow">Get the Top 100 app</p>
      <h2 id="top100-app-guide-heading">Your club, fixtures and alerts on your home screen</h2>
      <ol>
        <li>
          <strong>Add Top 100 to your home screen</strong>
          <ul>{installSteps.map((step) => <li key={step.key}><span>{step.label}:</span> {step.text}</li>)}</ul>
        </li>
        <li>
          <strong>Open Top 100 from your home screen</strong>
          <span>{signedIn ? 'It opens like an app, already signed in.' : 'It opens like an app. Sign in with your email as usual.'}</span>
        </li>
        <li>
          <strong>Tap Turn on notifications</strong>
          <span>{signedIn ? <>In the <a href="#notifications">Notifications</a> section below. </> : 'In the Notifications section once you are signed in. '}On iPhone, notifications only work when Top 100 is opened from the home screen.</span>
        </li>
      </ol>
    </section>
  );
}
