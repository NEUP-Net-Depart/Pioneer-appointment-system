import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { tutorialProfiles, journeysFor } from './journeys.js';
import { simulation } from './simulation/api.js';
import {
  initialize,
  highlight,
  perform,
  stopHighlight,
  setPresentation,
  updatePresentation
} from './guide.js';
import './coach.css';

const parameters = new URLSearchParams(location.search);
const journey = journeysFor(simulation.state.profile).find(
  (item) => item.id === parameters.get('journey')
);

function openGuide(profileId, journeyId) {
  location.assign(
    `${import.meta.env.BASE_URL}?${new URLSearchParams({ profile: profileId, journey: journeyId })}`
  );
}

function Coach() {
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(!!journey);
  const [chooser, setChooser] = useState(!journey);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [portalHost, setPortalHost] = useState(document.body);
  const state = useRef({});
  const lock = useRef(false);
  const sequence = useRef(0);
  state.current = { index, ready, running };

  function exit() {
    sequence.current++;
    setRunning(false);
    setFinished(false);
    setError('');
    stopHighlight();
  }

  async function next() {
    if (lock.current || !state.current.ready || !state.current.running) return;
    lock.current = true;
    updatePresentation({ loading: true });
    try {
      const current = state.current.index;
      if (journey.steps[current].action) await perform(current, true);
      if (!state.current.running) return;
      if (current === journey.steps.length - 1) {
        stopHighlight();
        setRunning(false);
        setFinished(true);
      } else setIndex(current + 1);
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
    }
  }

  async function focusStep() {
    const request = ++sequence.current;
    setReady(false);
    setError('');
    try {
      await initialize();
      if (request !== sequence.current) return;
      const position = state.current.index;
      setPresentation({
        onNext: () => void next(),
        onExit: exit,
        index: position,
        total: journey.steps.length,
        final: position === journey.steps.length - 1
      });
      await highlight(state.current.index);
      if (request === sequence.current) setReady(true);
    } catch (failure) {
      if (request === sequence.current) setError(failure.message);
    }
  }

  useEffect(() => {
    if (journey && running && !chooser) void focusStep();
    return () => {
      sequence.current++;
      stopHighlight();
    };
  }, [index, running, chooser]);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dialog = [...document.querySelectorAll('dialog[open]')]
        .filter((item) => !item.matches('.tutorial-start-dialog, .driver-popover'))
        .at(-1);
      setPortalHost(dialog || document.body);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open']
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    function listener(event) {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== 'pioneer-academy'
      )
        return;
      if (event.data.type === 'external') setNotice(`官方入口：${event.data.url}`);
      if (event.data.type === 'download') setNotice('示例文件已生成');
      if (event.data.type === 'render-error') setError(event.data.message);
    }
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const profile =
    tutorialProfiles.find((item) => item.id === simulation.state.profile.id) || tutorialProfiles[0];
  return (
    <>
      {!chooser &&
        !finished &&
        !running &&
        createPortal(
          <div className="tutorial-controls" role="region" aria-label="教程控制">
            {running ? (
              <>
                <span>
                  {profile.name}
                  <span className="tutorial-control-divider">·</span>
                  {journey.steps[index].phase}
                </span>
                <button onClick={exit}>退出引导</button>
              </>
            ) : (
              <button onClick={() => setChooser(true)}>操作教程</button>
            )}
          </div>,
          portalHost
        )}
      {notice &&
        createPortal(
          <div className="tutorial-notice" role="status">
            {notice}
          </div>,
          portalHost
        )}
      {error &&
        createPortal(
          <section className="tutorial-error" role="alert">
            <strong>这一步暂未完成</strong>
            <p>{error}</p>
            <div>
              <button onClick={exit}>退出引导</button>
              <button onClick={() => void focusStep()}>重试这一步</button>
            </div>
          </section>,
          portalHost
        )}
      {finished &&
        createPortal(
          <section className="tutorial-finished" role="status">
            <h2>{journey.title}已完成</h2>
            <p>操作结果保留在当前页面，可以自己试一试，或选择其他工作流程。</p>
            <div>
              <button onClick={exit}>自由操作</button>
              <button
                className="tutorial-primary"
                onClick={() => {
                  setFinished(false);
                  setChooser(true);
                }}
              >
                其他流程
              </button>
            </div>
          </section>,
          portalHost
        )}
      {chooser && <StartDialog initialProfile={profile.id} onClose={() => setChooser(false)} />}
    </>
  );
}

function StartDialog({ initialProfile, onClose }) {
  const dialog = useRef(null);
  const [profileId, setProfileId] = useState(initialProfile);
  const [journeyId, setJourneyId] = useState(() => journeysFor({ id: initialProfile })[0].id);
  const paths = journeysFor({ id: profileId });
  useEffect(() => {
    dialog.current.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="tutorial-start-dialog"
      aria-labelledby="tutorial-start-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <span>先锋 · 后台教程</span>
        <button aria-label="关闭教程，直接使用页面" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <h1 id="tutorial-start-title">
        认识后台，
        <br />
        走一遍日常工作。
      </h1>
      <fieldset className="tutorial-choice">
        <legend>你的身份</legend>
        <div>
          {tutorialProfiles.map((item) => (
            <button
              key={item.id}
              aria-pressed={profileId === item.id}
              onClick={() => {
                setProfileId(item.id);
                setJourneyId(journeysFor(item)[0].id);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="tutorial-choice tutorial-path-choice">
        <legend>从这里开始</legend>
        <div>
          {paths.map((item) => (
            <button
              key={item.id}
              aria-pressed={journeyId === item.id}
              onClick={() => setJourneyId(item.id)}
            >
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <footer>
        <p>全程点“下一步”，页面会演示对应操作。</p>
        <button className="tutorial-primary" onClick={() => openGuide(profileId, journeyId)}>
          开始演示
        </button>
      </footer>
    </dialog>
  );
}

if (!parameters.has('lesson') && !parameters.has('harness'))
  createRoot(document.getElementById('academy-root')).render(<Coach />);
