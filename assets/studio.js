(() => {
  const $ = (id) => document.getElementById(id);
  const menuButton = $("menuButton");
  const navLinks = $("navLinks");
  const projectsGrid = $("projectsGrid");
  const adminSection = $("admin");
  const adminPanel = $("adminPanel");
  const ownerAccess = $("ownerAccess");
  const projectForm = $("projectForm");
  const adminStatus = $("adminStatus");
  const loginDialog = $("ownerLoginDialog");
  let projects = [];
  let legacyProjects = [];
  let selectedImageData = "";
  let adminAuthenticated = false;

  try {
    const saved = JSON.parse(localStorage.getItem("terenceWebStudioProjects_v1") || "[]");
    legacyProjects = Array.isArray(saved) ? saved : [];
  } catch {
    legacyProjects = [];
  }

  menuButton?.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });
  navLinks?.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  }));
  $("year").textContent = new Date().getFullYear();

  function safeExternalUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[char]));
  }

  function setStatus(message) {
    adminStatus.textContent = message || "";
  }

  async function apiRequest(path = "/api/projects", options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: { ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }

  async function loadRemoteProjects(admin = false) {
    projects = await apiRequest(admin ? "/api/projects?admin=1" : "/api/projects");
    if (!Array.isArray(projects)) projects = [];
    refresh();
  }

  function renderPublicProjects() {
    const featured = projectsGrid.querySelector('[data-featured="true"]') ||
      projectsGrid.querySelector(".project");
    projectsGrid.innerHTML = "";
    if (featured) {
      featured.dataset.featured = "true";
      projectsGrid.appendChild(featured);
    }

    const published = projects.filter(project => project.status === "published");
    published.forEach(project => {
      const url = safeExternalUrl(project.url);
      const article = document.createElement("article");
      article.className = "project";
      const visual = project.image
        ? \`<img class="project-image" src="\${project.image}" alt="\${escapeHtml(project.title)} website screenshot" loading="lazy">\`
        : \`<div class="project-visual alt">\${escapeHtml(project.title)}</div>\`;
      article.innerHTML = \`\${visual}
        <div class="project-body">
          <span class="tag">Published project</span>
          <span class="project-category">\${escapeHtml(project.category)}</span>
          <h3>\${escapeHtml(project.title)}</h3>
          <p>\${escapeHtml(project.description)}</p>
          <a class="project-link" href="\${escapeHtml(url)}" target="_blank" rel="noopener">View live website ↗</a>
        </div>\`;
      projectsGrid.appendChild(article);
    });
    $("projectsNotice").textContent = published.length
      ? "A selection of completed work. More projects will be added as they are published."
      : "More completed projects will appear here.";
  }

  function renderAdminProjects() {
    const list = $("adminProjectList");
    if (!projects.length) {
      list.innerHTML = '<div class="empty-manager">No projects added yet. Use the form above to add your first project.</div>';
      return;
    }
    list.innerHTML = "";
    [...projects].sort((a,b) => b.updatedAt - a.updatedAt).forEach(project => {
      const row = document.createElement("div");
      row.className = "manager-row";
      const statusClass = project.status === "published" ? "published" : "";
      row.innerHTML = \`
        <div class="manager-row-main">
          <strong>\${escapeHtml(project.title)}</strong>
          <p>\${escapeHtml(project.category)} · \${escapeHtml(project.description)}</p>
          <span class="status-pill \${statusClass}">\${project.status === "published" ? "Published" : "Draft"}</span>
        </div>
        <div class="manager-row-actions">
          <button class="btn secondary" type="button" data-action="edit" data-id="\${escapeHtml(project.id)}">Edit</button>
          <button class="btn secondary" type="button" data-action="toggle" data-id="\${escapeHtml(project.id)}">\${project.status === "published" ? "Unpublish" : "Publish"}</button>
          <button class="btn secondary" type="button" data-action="delete" data-id="\${escapeHtml(project.id)}">Delete</button>
        </div>\`;
      list.appendChild(row);
    });
  }

  function refresh() {
    renderPublicProjects();
    if (adminAuthenticated) renderAdminProjects();
  }

  function resetForm() {
    projectForm.reset();
    $("projectId").value = "";
    selectedImageData = "";
    $("formHeading").textContent = "Add a project";
    $("publishProjectButton").textContent = "Publish project";
    $("draftProjectButton").textContent = "Save as draft";
    $("projectImage").value = "";
  }

  async function openManager() {
    $("ownerPassword").value = "";
    $("ownerLoginStatus").textContent = "";
    loginDialog.showModal();
    $("ownerPassword").focus();
  }

  ownerAccess.addEventListener("click", openManager);
  $("cancelOwnerLogin").addEventListener("click", () => loginDialog.close());
  $("ownerLoginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = $("submitOwnerLogin");
    submit.disabled = true;
    $("ownerLoginStatus").textContent = "Signing in…";
    try {
      await apiRequest("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", password: $("ownerPassword").value })
      });
      adminAuthenticated = true;
      await loadRemoteProjects(true);

      if (!projects.length && legacyProjects.length) {
        const shouldImport = window.confirm("We found projects saved in this browser. Import them into shared online storage now?");
        if (shouldImport) {
          await apiRequest("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "import", projects: legacyProjects })
          });
          legacyProjects = [];
          localStorage.removeItem("terenceWebStudioProjects_v1");
          await loadRemoteProjects(true);
          setStatus("Your existing browser projects were imported into shared online storage.");
        }
      }

      loginDialog.close();
      adminSection.classList.add("revealed");
      adminPanel.classList.add("open");
      adminSection.scrollIntoView({ behavior: "smooth", block: "start" });
      setStatus("Signed in. Your projects are connected to shared online storage.");
    } catch (error) {
      adminAuthenticated = false;
      $("ownerLoginStatus").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  $("closeManager").addEventListener("click", async () => {
    try {
      await apiRequest("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" })
      });
    } catch {}
    adminAuthenticated = false;
    adminPanel.classList.remove("open");
    adminSection.classList.remove("revealed");
    $("projects").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("resetProjectButton").addEventListener("click", () => {
    resetForm();
    setStatus("Form cleared.");
  });

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Please choose a valid image file."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("The selected image could not be opened."));
        image.onload = () => {
          const maxDimension = 1200;
          const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  $("projectImage").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      selectedImageData = await resizeImage(file);
      setStatus("Screenshot ready. Save the project to upload it to shared storage.");
    } catch (error) {
      selectedImageData = "";
      setStatus(error.message);
      event.target.value = "";
    }
  });

  async function saveProject(status) {
    if (!adminAuthenticated) {
      setStatus("Please sign in again to manage projects.");
      return;
    }
    const title = $("projectTitle").value.trim();
    const category = $("projectCategory").value;
    const description = $("projectDescription").value.trim();
    const url = safeExternalUrl($("projectUrl").value.trim());
    if (!title || !description || !url) {
      setStatus("Please complete the title, description and a valid http(s) live website URL.");
      return;
    }

    const id = $("projectId").value || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const existing = projects.find(project => project.id === id);
    const project = {
      id, title, category, description, url,
      image: selectedImageData || existing?.image || "",
      status,
      updatedAt: Date.now()
    };

    setStatus("Saving project to shared online storage…");
    try {
      await apiRequest("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", project })
      });
      await loadRemoteProjects(true);
      resetForm();
      setStatus(status === "published"
        ? "Project published. It is now available on every device."
        : "Project saved as a draft in shared online storage.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  projectForm.addEventListener("submit", event => {
    event.preventDefault();
    saveProject("published");
  });
  $("draftProjectButton").addEventListener("click", () => {
    if (!projectForm.reportValidity()) return;
    saveProject("draft");
  });

  $("adminProjectList").addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button || !adminAuthenticated) return;
    const project = projects.find(item => item.id === button.dataset.id);
    if (!project) return;

    if (button.dataset.action === "edit") {
      $("projectId").value = project.id;
      $("projectTitle").value = project.title;
      $("projectCategory").value = project.category;
      $("projectDescription").value = project.description;
      $("projectUrl").value = project.url;
      selectedImageData = project.image || "";
      $("formHeading").textContent = "Edit project";
      $("publishProjectButton").textContent = "Save and publish";
      $("draftProjectButton").textContent = "Save as draft";
      $("projectForm").scrollIntoView({ behavior: "smooth", block: "center" });
      setStatus("Editing " + project.title + ". Choose a new screenshot only if you want to replace the current one.");
    }

    if (button.dataset.action === "toggle") {
      const updated = { ...project, status: project.status === "published" ? "draft" : "published", updatedAt: Date.now() };
      try {
        await apiRequest("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", project: updated })
        });
        await loadRemoteProjects(true);
        setStatus(updated.status === "published" ? "Project published across devices." : "Project moved to drafts.");
      } catch (error) { setStatus(error.message); }
    }

    if (button.dataset.action === "delete") {
      if (!confirm(\`Delete "\${project.title}" from the shared portfolio?\`)) return;
      try {
        await apiRequest("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id: project.id })
        });
        await loadRemoteProjects(true);
        setStatus("Project deleted from shared online storage.");
      } catch (error) { setStatus(error.message); }
    }
  });

  loadRemoteProjects(false).catch(() => {
    projects = [];
    refresh();
    $("projectsNotice").textContent = "Projects are temporarily unavailable. Please try again later.";
  });
})();