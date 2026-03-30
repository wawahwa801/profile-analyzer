import "./style.css";

const QUESTIONS = [
  "When you message someone first, what tone do you usually aim for?",
  "What do you hope people feel when they read your profile?",
  "How do you decide what photos to include (or leave out)?",
];

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function analyze(payload) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function renderMeter(score, label) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  return `
    <div class="meter-wrap">
      <div class="meter-header">
        <span class="meter-label">Authenticity meter</span>
        <span class="meter-value">${s}</span>
      </div>
      <div class="meter-bar" role="progressbar" aria-valuenow="${s}" aria-valuemin="0" aria-valuemax="100">
        <div class="meter-fill" style="width:${s}%"></div>
      </div>
      ${label ? `<p class="badge">${escapeHtml(label)}</p>` : ""}
    </div>
  `;
}

function renderResults(result) {
  const tips = (result.tips || [])
    .map((tip) => `<li>${escapeHtml(tip)}</li>`)
    .join("");
  const signals = (result.signals || [])
    .map((signal) => `<li>${escapeHtml(signal)}</li>`)
    .join("");

  return `
    <section class="results card" id="results">
      <h2>Your deconstruction</h2>
      ${renderMeter(result.authenticity_score, result.authenticity_label)}
      <div class="section-block">
        <h3>What your profile signals</h3>
        <p>${escapeHtml(result.summary || "")}</p>
      </div>
      <div class="section-block">
        <h3>Realness vs. performance</h3>
        <p>${escapeHtml(result.performing_vs_real || "")}</p>
      </div>
      <div class="section-block">
        <h3>Signals</h3>
        <ul>${signals || "<li>No extra signals listed.</li>"}</ul>
      </div>
      <div class="section-block">
        <h3>Tips toward authenticity</h3>
        <ul>${tips || "<li>No tips returned.</li>"}</ul>
      </div>
    </section>
  `;
}

function buildApp() {
  const root = document.getElementById("app");
  root.innerHTML = `
    <div class="layout">
      <header class="hero">
        <h1>Deconstruct your dating profile</h1>
        <p>
          Social media can flatten real personality. This tool helps you see what your profile actually signals,
          where it feels performative, and how to express yourself with grounded authenticity.
        </p>
      </header>

      <form id="form" class="card">
        <h2>Your profile</h2>

        <div class="field">
          <label for="bio">Bio</label>
          <textarea id="bio" name="bio" placeholder="Your self-summary, prompts, or tagline..." required></textarea>
        </div>

        <div class="stats-grid">
          <div class="field">
            <label for="age">Age (optional)</label>
            <input type="number" id="age" name="age" min="18" max="120" placeholder="e.g. 29" />
          </div>
          <div class="field">
            <label for="location">Location (optional)</label>
            <input type="text" id="location" name="location" placeholder="City or region" />
          </div>
        </div>

        <div class="field">
          <label for="stats_extra">Other stats / context (optional)</label>
          <textarea id="stats_extra" name="stats_extra" rows="3" placeholder="Height, job, lifestyle, what you're looking for..."></textarea>
        </div>

        <div class="field">
          <label>Photos (optional, up to 6)</label>
          <div class="file-zone">
            Add screenshots or exports so the backend can read visual consistency and vibe.
            <br />
            <input type="file" id="photos" accept="image/*" multiple />
            <div class="preview-row" id="previews"></div>
          </div>
        </div>

        <h2 style="margin-top: 1.5rem">How you show up</h2>
        <div class="questions-list" id="questions"></div>

        <div class="actions">
          <button type="submit" class="btn" id="submit">Analyze profile</button>
        </div>
      </form>

      <div id="error" class="error-banner hidden"></div>
      <div id="out"></div>

      <footer>
        Uses your local Flask API. Set <code>GROQ_API_KEY</code> in <code>backend/.env</code>
        (or <code>OPENAI_API_KEY</code>) for live analysis.
      </footer>
    </div>
  `;

  const questionsRoot = root.querySelector("#questions");
  QUESTIONS.forEach((question, idx) => {
    questionsRoot.appendChild(
      el(`
      <div class="question-block">
        <div class="q-label">${escapeHtml(question)}</div>
        <textarea name="q_${idx}" rows="3" placeholder="Be honest—there are no wrong answers."></textarea>
      </div>
    `)
    );
  });

  const photoInput = root.querySelector("#photos");
  const previews = root.querySelector("#previews");
  photoInput.addEventListener("change", async () => {
    previews.innerHTML = "";
    const files = Array.from(photoInput.files || []).slice(0, 6);
    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "Profile preview";
      previews.appendChild(img);
    }
  });

  const form = root.querySelector("#form");
  const errorEl = root.querySelector("#error");
  const out = root.querySelector("#out");
  const submitBtn = root.querySelector("#submit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.classList.add("hidden");
    out.innerHTML = "";

    const bio = root.querySelector("#bio").value.trim();
    const age = root.querySelector("#age").value.trim();
    const location = root.querySelector("#location").value.trim();
    const statsExtra = root.querySelector("#stats_extra").value.trim();

    const questionAnswers = QUESTIONS.map((question, idx) => ({
      question,
      answer: root.querySelector(`[name="q_${idx}"]`).value.trim(),
    }));

    const files = Array.from(photoInput.files || []).slice(0, 6);
    const images = [];
    for (const file of files) {
      images.push(await fileToDataUrl(file));
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Analyzing...`;

    try {
      const result = await analyze({
        bio,
        stats: {
          age: age || null,
          location: location || null,
          extra: statsExtra || null,
        },
        question_answers: questionAnswers,
        images,
      });
      out.innerHTML = renderResults(result);
      document
        .getElementById("results")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong.";
      errorEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Analyze profile";
    }
  });
}

buildApp();
