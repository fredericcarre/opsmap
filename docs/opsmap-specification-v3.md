# OpsMap - Spécification Technique Complète v3

## Vision du Projet

**OpsMap** est un outil AIOps léger et sécurisé permettant aux équipes Ops et Métier de :
- **Cartographier** leurs applications et dépendances (appelées **Maps**)
- **Monitorer** l'état en temps réel avec prédiction des temps de démarrage
- **Piloter** (démarrer/arrêter/réparer) leurs applications intelligemment
- **Visualiser** l'obsolescence et les graphes de dépendances
- **Tracer** 100% des actions avec historique complet

**Philosophie** : Simplicité, déclaratif, multi-plateforme, sécurité zero-trust, GitOps natif, scalabilité massive (50K+ composants).

---

## Principes Architecturaux Clés

### 🔒 Sécurité First
- Images Docker "distroless" ou Alpine minimales
- Scan CVE dans le pipeline CI/CD (Trivy, Grype)
- Zero secret en dur, rotation automatique
- mTLS entre tous les composants
- RBAC granulaire avec audit trail

### 📦 GitOps Natif
- Les **Maps** (cartographies) sont versionnées dans Git
- Chaque modification = commit traçable
- Rollback instantané via git revert
- Review des Maps via Pull Request

### ⚡ Scalabilité Massive
- Architecture event-driven (pas de polling)
- Cache distribué Redis Cluster
- Sharding par tenant/namespace
- Support 50K+ composants par instance

### 🔧 Réparation Chirurgicale
- Redémarrage d'une branche sans toucher au reste
- Détection automatique du périmètre impacté
- Mode "dry-run" pour prévisualiser les actions

### 📊 Analytics Prédictifs
- Temps de démarrage/arrêt historisés
- Prédiction basée sur les patterns
- Alertes proactives sur anomalies

---

## 1. Architecture Globale - Modèle Gateway

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              OPSMAP ARCHITECTURE v3                                      │
│                              (Gateway Model + mTLS)                                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                            ZONE MANAGEMENT                                       │   │
│  │                                                                                  │   │
│  │    ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐         │   │
│  │    │    Frontend     │     │  OpsMap Backend │     │   PostgreSQL    │         │   │
│  │    │    (React)      │────▶│   (Node.js/TS)  │────▶│   + Redis       │         │   │
│  │    │                 │     │                 │     │                 │         │   │
│  │    └─────────────────┘     │  • API REST     │     └─────────────────┘         │   │
│  │                            │  • WebSocket    │                                  │   │
│  │                            │  • MCP Server   │                                  │   │
│  │                            │  • FSM Engine   │                                  │   │
│  │                            │  • GitOps Sync  │                                  │   │
│  │                            └────────┬────────┘                                  │   │
│  │                                     │                                           │   │
│  │                            mTLS (certificats)                                   │   │
│  │                                     │                                           │   │
│  └─────────────────────────────────────┼───────────────────────────────────────────┘   │
│                                        │                                                │
│         ┌──────────────────────────────┼──────────────────────────────┐                │
│         │                              │                              │                 │
│         ▼                              ▼                              ▼                 │
│  ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐        │
│  │  Gateway DMZ    │          │  Gateway PROD   │          │  Gateway DEV    │        │
│  │     (Rust)      │          │     (Rust)      │          │     (Rust)      │        │
│  │                 │          │                 │          │                 │        │
│  │ bind: 10.1.0.1  │          │ bind: 10.2.0.1  │          │ bind: 10.3.0.1  │        │
│  │ agents: 50      │          │ agents: 500     │          │ agents: 100     │        │
│  └────────┬────────┘          └────────┬────────┘          └────────┬────────┘        │
│           │                            │                            │                  │
│           │ mTLS                       │ mTLS                       │ mTLS            │
│           │                            │                            │                  │
│  ┌────────┴────────┐          ┌────────┴────────┐          ┌────────┴────────┐        │
│  │   ZONE DMZ      │          │   ZONE PROD     │          │   ZONE DEV      │        │
│  │   10.1.x.x      │          │   10.2.x.x      │          │   10.3.x.x      │        │
│  │                 │          │                 │          │                 │        │
│  │ ┌─────┐ ┌─────┐ │          │ ┌─────┐ ┌─────┐ │          │ ┌─────┐ ┌─────┐ │        │
│  │ │Agent│ │Agent│ │          │ │Agent│ │Agent│ │          │ │Agent│ │Agent│ │        │
│  │ │Rust │ │Rust │ │          │ │Rust │ │Rust │ │          │ │Rust │ │Rust │ │        │
│  │ └─────┘ └─────┘ │          │ └─────┘ └─────┘ │          │ └─────┘ └─────┘ │        │
│  └─────────────────┘          └─────────────────┘          └─────────────────┘        │
│                                                                                         │
│  FLUX:                                                                                  │
│  1. Agent démarre → Connexion SORTANTE vers Gateway (mTLS)                             │
│  2. Agent s'enregistre (auto-découverte)                                               │
│  3. Gateway maintient registre des agents de sa zone                                   │
│  4. Backend se connecte aux Gateways (mTLS)                                            │
│  5. Commandes: Backend → Gateway → Agent → Gateway → Backend                           │
│                                                                                         │
│  SÉCURITÉ:                                                                              │
│  • Agents n'acceptent AUCUNE connexion entrante                                        │
│  • Tout le trafic est mTLS (certificats X.509)                                         │
│  • Backend ne connaît pas les agents directement                                       │
│  • Chaque zone est isolée par sa Gateway                                               │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Agent Rust - Spécification Détaillée

### 2.1 Principes Fondamentaux

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     AGENT RUST - PRINCIPES CRITIQUES                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1️⃣ DÉTACHEMENT COMPLET DES PROCESSUS LANCÉS                               │
│  ───────────────────────────────────────────────                            │
│  • L'agent lance les processus en mode "fire and forget"                   │
│  • Double-fork + setsid pour créer une nouvelle session                    │
│  • Le processus fils devient orphelin (reparenté à init/systemd)           │
│  • Crash de l'agent ≠ crash des processus clients                          │
│  • Aucun handle/file descriptor maintenu sur les processus enfants         │
│                                                                             │
│  2️⃣ AUCUNE CONSOMMATION DE HANDLES                                         │
│  ─────────────────────────────────                                          │
│  • Fermeture immédiate de stdin/stdout/stderr après fork                   │
│  • Redirection vers /dev/null ou fichier log dédié                         │
│  • Pas de pipe maintenu entre agent et processus                           │
│  • waitpid() avec WNOHANG pour éviter zombies, sans bloquer                │
│                                                                             │
│  3️⃣ CONNEXION SORTANTE UNIQUEMENT                                          │
│  ──────────────────────────────────                                         │
│  • Agent initie TOUTES les connexions (vers Gateway)                       │
│  • Aucun port en écoute sur l'agent                                        │
│  • Compatible avec firewalls stricts (outbound only)                       │
│                                                                             │
│  4️⃣ RÉSILIENCE                                                             │
│  ─────────────                                                              │
│  • Reconnexion automatique à la Gateway                                    │
│  • Buffer local si Gateway indisponible                                    │
│  • Watchdog interne (self-restart si bloqué)                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Process Detachment - Implémentation Rust

```rust
// src/agent/executor/detached.rs

use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use nix::unistd::{fork, setsid, ForkResult};
use nix::sys::wait::{waitpid, WaitPidFlag};

/// Lance un processus complètement détaché de l'agent
/// 
/// Garanties:
/// - Le processus survit au crash/restart de l'agent
/// - Aucun file descriptor partagé
/// - Aucun handle maintenu
/// - Le processus est reparenté à init/systemd
pub struct DetachedExecutor {
    log_dir: PathBuf,
}

impl DetachedExecutor {
    /// Lance une commande en mode complètement détaché
    /// 
    /// Technique: Double-fork
    /// 1. Premier fork: crée un processus intermédiaire
    /// 2. setsid(): crée une nouvelle session (détache du terminal)
    /// 3. Second fork: le petit-fils devient orphelin
    /// 4. Le fils intermédiaire exit() immédiatement
    /// 5. Le petit-fils est reparenté à PID 1 (init/systemd)
    pub fn spawn_detached(
        &self,
        command: &str,
        args: &[&str],
        env: &HashMap<String, String>,
        working_dir: Option<&Path>,
        run_as_user: Option<&str>,
    ) -> Result<DetachedProcessInfo, ExecutorError> {
        
        let log_file = self.log_dir.join(format!(
            "proc_{}_{}.log",
            command.replace("/", "_"),
            chrono::Utc::now().timestamp()
        ));
        
        // Premier fork
        match unsafe { fork() } {
            Ok(ForkResult::Parent { child }) => {
                // Parent (agent): attend juste que le fils intermédiaire exit
                // Utilise WNOHANG pour ne pas bloquer
                let start = std::time::Instant::now();
                loop {
                    match waitpid(child, Some(WaitPidFlag::WNOHANG)) {
                        Ok(WaitStatus::Exited(_, _)) => break,
                        Ok(WaitStatus::StillAlive) => {
                            if start.elapsed() > Duration::from_secs(5) {
                                return Err(ExecutorError::ForkTimeout);
                            }
                            std::thread::sleep(Duration::from_millis(10));
                        }
                        Err(e) => return Err(ExecutorError::WaitError(e)),
                        _ => break,
                    }
                }
                
                Ok(DetachedProcessInfo {
                    launched_at: chrono::Utc::now(),
                    command: command.to_string(),
                    log_file: log_file.clone(),
                    // Note: on ne connaît pas le PID du petit-fils
                    // C'est intentionnel - on ne maintient aucune référence
                })
            }
            
            Ok(ForkResult::Child) => {
                // Fils intermédiaire: crée nouvelle session et re-fork
                
                // Nouvelle session (détache du terminal controlling)
                if let Err(_) = setsid() {
                    std::process::exit(1);
                }
                
                // Second fork
                match unsafe { fork() } {
                    Ok(ForkResult::Parent { .. }) => {
                        // Fils intermédiaire: exit immédiatement
                        // Le petit-fils devient orphelin → reparenté à init
                        std::process::exit(0);
                    }
                    
                    Ok(ForkResult::Child) => {
                        // Petit-fils: c'est lui qui exécute vraiment la commande
                        
                        // Ferme TOUS les file descriptors hérités
                        // Sauf stdin/stdout/stderr qu'on redirige
                        close_all_fds_except(&[0, 1, 2]);
                        
                        // Redirige stdin depuis /dev/null
                        let dev_null = std::fs::File::open("/dev/null").unwrap();
                        nix::unistd::dup2(dev_null.as_raw_fd(), 0).unwrap();
                        
                        // Redirige stdout/stderr vers fichier log
                        let log = std::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&log_file)
                            .unwrap();
                        nix::unistd::dup2(log.as_raw_fd(), 1).unwrap();
                        nix::unistd::dup2(log.as_raw_fd(), 2).unwrap();
                        
                        // Change de répertoire de travail
                        if let Some(dir) = working_dir {
                            std::env::set_current_dir(dir).ok();
                        }
                        
                        // Change d'utilisateur si demandé
                        if let Some(user) = run_as_user {
                            switch_user(user).ok();
                        }
                        
                        // Exécute la commande (remplace le processus)
                        let mut cmd = Command::new(command);
                        cmd.args(args);
                        for (k, v) in env {
                            cmd.env(k, v);
                        }
                        
                        // exec() - ne retourne jamais si succès
                        let err = cmd.exec();
                        eprintln!("exec failed: {}", err);
                        std::process::exit(1);
                    }
                    
                    Err(_) => std::process::exit(1),
                }
            }
            
            Err(e) => Err(ExecutorError::ForkError(e)),
        }
    }
    
    /// Lance une commande et ATTEND le résultat (pour les commandes courtes)
    /// Utilisé pour: healthchecks, commandes de status, etc.
    /// 
    /// IMPORTANT: Timeout strict pour éviter de bloquer l'agent
    pub async fn spawn_and_wait(
        &self,
        command: &str,
        args: &[&str],
        timeout: Duration,
        run_as_user: Option<&str>,
    ) -> Result<CommandResult, ExecutorError> {
        
        let mut cmd = tokio::process::Command::new(command);
        cmd.args(args);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        
        // Changement d'utilisateur via sudo si nécessaire
        if let Some(user) = run_as_user {
            cmd = tokio::process::Command::new("sudo");
            cmd.args(&["-u", user, "--", command]);
            cmd.args(args);
        }
        
        // Kill on drop: si l'agent est interrompu, tue le processus
        cmd.kill_on_drop(true);
        
        let start = std::time::Instant::now();
        
        let child = cmd.spawn()?;
        
        // Attend avec timeout
        let result = tokio::time::timeout(timeout, child.wait_with_output()).await;
        
        let duration = start.elapsed();
        
        match result {
            Ok(Ok(output)) => Ok(CommandResult {
                exit_code: output.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                duration_ms: duration.as_millis() as u64,
                timed_out: false,
            }),
            Ok(Err(e)) => Err(ExecutorError::IoError(e)),
            Err(_) => {
                // Timeout: le processus est tué automatiquement (kill_on_drop)
                Ok(CommandResult {
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: "Command timed out".to_string(),
                    duration_ms: timeout.as_millis() as u64,
                    timed_out: true,
                })
            }
        }
    }
}

/// Ferme tous les file descriptors sauf ceux spécifiés
fn close_all_fds_except(keep: &[i32]) {
    // Récupère la limite de FDs
    let max_fd = match nix::sys::resource::getrlimit(nix::sys::resource::Resource::RLIMIT_NOFILE) {
        Ok((soft, _)) => soft as i32,
        Err(_) => 1024,
    };
    
    for fd in 0..max_fd {
        if !keep.contains(&fd) {
            // Ignore les erreurs (FD peut ne pas exister)
            let _ = nix::unistd::close(fd);
        }
    }
}

/// Change l'utilisateur effectif du processus
fn switch_user(username: &str) -> Result<(), ExecutorError> {
    use nix::unistd::{setuid, setgid, Uid, Gid};
    use users::{get_user_by_name, get_group_by_name};
    
    let user = get_user_by_name(username)
        .ok_or(ExecutorError::UserNotFound(username.to_string()))?;
    
    let uid = Uid::from_raw(user.uid());
    let gid = Gid::from_raw(user.primary_group_id());
    
    // Change le groupe d'abord (nécessite encore les privilèges root)
    setgid(gid)?;
    
    // Puis change l'utilisateur
    setuid(uid)?;
    
    Ok(())
}

#[derive(Debug, Clone)]
pub struct DetachedProcessInfo {
    pub launched_at: chrono::DateTime<chrono::Utc>,
    pub command: String,
    pub log_file: PathBuf,
}

#[derive(Debug, Clone)]
pub struct CommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
}
```

### 2.3 Configuration Agent Complète

```yaml
# /etc/opsmap/agent.yaml

agent:
  # Identifiant unique (auto-généré si absent basé sur hostname + MAC)
  id: ""  # Laisser vide pour auto-génération
  
  # Labels pour filtrage/groupement (auto-découverte enrichie manuellement)
  labels:
    environment: production
    role: database
    datacenter: paris-dc1
    team: trading
    
  # Version de l'agent (readonly, informatif)
  # version: "1.0.0"

# Configuration réseau
network:
  # Interface réseau sur laquelle se connecter à la Gateway
  # Critique pour les serveurs multi-NIC
  bind_interface: "eth1"
  # Alternative: spécifier directement l'IP
  # bind_address: "10.2.1.50"
  
  # Port local (0 = automatique, recommandé)
  bind_port: 0

# Connexion à la Gateway
gateway:
  # URL de la Gateway de cette zone
  # L'agent initie TOUJOURS la connexion (outbound)
  url: "wss://gateway-prod.internal:8443"
  
  # Gateways de fallback (si la principale est down)
  fallback_urls:
    - "wss://gateway-prod-2.internal:8443"
    - "wss://gateway-prod-3.internal:8443"
  
  # Reconnexion automatique
  reconnect:
    initial_delay_ms: 1000
    max_delay_ms: 30000
    multiplier: 2.0
    max_attempts: 0  # 0 = infini
  
  # Heartbeat
  heartbeat_interval_secs: 30
  heartbeat_timeout_secs: 10

# Configuration TLS/mTLS (OBLIGATOIRE)
tls:
  # Certificat client de l'agent
  cert_file: "/etc/opsmap/certs/agent.crt"
  key_file: "/etc/opsmap/certs/agent.key"
  
  # CA pour vérifier la Gateway
  ca_file: "/etc/opsmap/certs/ca.crt"
  
  # Vérification stricte du serveur
  verify_server: true
  verify_hostname: true
  
  # Versions TLS autorisées
  min_version: "1.2"
  # max_version: "1.3"

# Commandes natives (intégrées dans l'agent, pas de shell)
native_commands:
  # Système
  os_info: true
  disk_space: true
  memory_usage: true
  cpu_load: true
  uptime: true
  
  # Réseau
  network_interfaces: true
  port_check: true
  http_check: true
  dns_lookup: true
  
  # Processus & Services
  process_list: true
  process_info: true
  service_status: true     # systemd (Linux) / SCM (Windows)
  service_control: true    # start/stop/restart
  
  # Fichiers
  file_exists: true
  file_read: true          # Avec limite de taille
  file_checksum: true      # md5, sha256, sha512
  file_stat: true
  
  # Discovery
  discover_services: true
  discover_processes: true
  discover_ports: true
  discover_docker: true    # Si Docker présent
  discover_kubernetes: true # Si kubectl accessible

# Exécution de scripts/commandes shell
scripts:
  enabled: true
  
  # Répertoires autorisés pour les scripts
  # Scripts hors de ces chemins = refusés
  allowed_paths:
    - "/opt/opsmap/scripts"
    - "/usr/local/opsmap/scripts"
  
  # Extensions autorisées
  allowed_extensions:
    - ".sh"
    - ".bash"
    - ".py"
    - ".pl"
  
  # Commandes shell autorisées (si script inline)
  # Vide = toutes autorisées, à utiliser avec précaution
  allowed_commands: []
  
  # Timeout par défaut
  default_timeout_secs: 300
  max_timeout_secs: 3600
  
  # Taille max de sortie capturée
  max_output_bytes: 1048576  # 1 MB

# Changement d'identité (exécution en tant qu'autre utilisateur)
identity:
  # Utilisateur sous lequel l'agent tourne
  run_as: "opsmap"
  
  # Utilisateurs vers lesquels l'agent peut switcher
  # Nécessite configuration sudo appropriée
  allowed_runas_users:
    - "oracle"
    - "postgres"
    - "tomcat"
    - "nginx"
  
  # Groupes autorisés (optionnel)
  allowed_runas_groups:
    - "dba"
    - "webadmin"

# Exécution détachée (processus longs)
detached_execution:
  # Répertoire pour les logs des processus détachés
  log_dir: "/var/log/opsmap/detached"
  
  # Rétention des logs
  log_retention_days: 7
  
  # Cleanup automatique des vieux logs
  cleanup_interval_hours: 24

# Buffer offline (si Gateway indisponible)
buffer:
  enabled: true
  path: "/var/lib/opsmap/buffer"
  max_size_mb: 100
  
  # Types d'événements à bufferiser
  buffer_events:
    - "discovery_result"
    - "metric"
    - "log"
  # Les commandes ne sont PAS bufferisées (exécution temps réel uniquement)

# Auto-découverte au démarrage
discovery:
  # Découverte automatique au démarrage de l'agent
  on_startup: true
  
  # Redécouverte périodique
  periodic_interval_secs: 3600  # 1 heure
  
  # Éléments à découvrir
  discover:
    services: true      # systemd units / Windows services
    processes: true     # Processus avec ports
    ports: true         # Ports en écoute
    docker: true        # Containers Docker
    filesystems: true   # Points de montage

# Watchdog interne
watchdog:
  enabled: true
  # Si l'agent ne répond pas au watchdog interne, il se restart
  timeout_secs: 60
  # Fichier PID pour monitoring externe
  pid_file: "/var/run/opsmap/agent.pid"

# Logging
logging:
  level: "info"  # trace, debug, info, warn, error
  
  # Fichier log
  file: "/var/log/opsmap/agent.log"
  
  # Rotation
  max_size_mb: 50
  max_files: 5
  compress: true
  
  # Format
  format: "json"  # json ou text
  
  # Inclure dans les logs
  include_timestamps: true
  include_target: true
  include_span: false  # Pour debug uniquement

# Métriques (optionnel, pour Prometheus)
metrics:
  enabled: false
  # Si enabled, expose /metrics sur ce port (localhost uniquement)
  # bind: "127.0.0.1:9100"
```

### 2.4 Structure du Projet Agent Rust

```
opsmap-agent/
├── Cargo.toml
├── Cargo.lock
├── build.rs                    # Build script (version, git hash)
├── src/
│   ├── main.rs                 # Entry point
│   ├── lib.rs                  # Library exports
│   │
│   ├── config/
│   │   ├── mod.rs
│   │   ├── loader.rs           # Charge YAML config
│   │   ├── validator.rs        # Valide la config
│   │   └── defaults.rs         # Valeurs par défaut
│   │
│   ├── connection/
│   │   ├── mod.rs
│   │   ├── gateway.rs          # Connexion WebSocket à la Gateway
│   │   ├── tls.rs              # Configuration mTLS
│   │   ├── reconnect.rs        # Stratégie de reconnexion
│   │   └── protocol.rs         # Messages JSON
│   │
│   ├── executor/
│   │   ├── mod.rs
│   │   ├── detached.rs         # ⭐ Exécution détachée (double-fork)
│   │   ├── foreground.rs       # Exécution avec attente (healthchecks)
│   │   ├── identity.rs         # Changement d'utilisateur (sudo)
│   │   └── sandbox.rs          # Restrictions de sécurité
│   │
│   ├── native_commands/
│   │   ├── mod.rs
│   │   ├── system.rs           # OS info, uptime
│   │   ├── disk.rs             # Disk space
│   │   ├── memory.rs           # Memory usage
│   │   ├── cpu.rs              # CPU load
│   │   ├── network.rs          # Interfaces, port check
│   │   ├── process.rs          # Process list/info
│   │   ├── service.rs          # systemd/Windows services
│   │   └── file.rs             # File operations
│   │
│   ├── discovery/
│   │   ├── mod.rs
│   │   ├── services.rs         # Découverte services
│   │   ├── processes.rs        # Découverte processus
│   │   ├── ports.rs            # Découverte ports
│   │   ├── docker.rs           # Découverte containers
│   │   └── kubernetes.rs       # Découverte pods (si kubectl)
│   │
│   ├── buffer/
│   │   ├── mod.rs
│   │   └── offline.rs          # Buffer si Gateway down
│   │
│   ├── watchdog/
│   │   ├── mod.rs
│   │   └── internal.rs         # Watchdog interne
│   │
│   └── metrics/
│       ├── mod.rs
│       └── prometheus.rs       # Export Prometheus (optionnel)
│
├── tests/
│   ├── integration/
│   │   ├── detached_test.rs
│   │   ├── gateway_test.rs
│   │   └── discovery_test.rs
│   └── unit/
│       └── ...
│
└── packaging/
    ├── systemd/
    │   └── opsmap-agent.service
    ├── windows/
    │   └── service.rs          # Windows Service wrapper
    ├── rpm/
    │   └── opsmap-agent.spec
    └── deb/
        └── control
```

---

## 3. Gateway Rust - Spécification

### 3.1 Rôle de la Gateway

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GATEWAY - RESPONSABILITÉS                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1️⃣ POINT D'ENTRÉE DE ZONE                                                 │
│  • Seul composant accessible depuis la zone Management                     │
│  • Les agents ne sont JAMAIS exposés directement                           │
│                                                                             │
│  2️⃣ REGISTRE DES AGENTS                                                    │
│  • Maintient la liste des agents connectés                                 │
│  • Gère l'auto-découverte (agents s'enregistrent)                          │
│  • Propage les infos au Backend                                            │
│                                                                             │
│  3️⃣ ROUTAGE DES COMMANDES                                                  │
│  • Reçoit commandes du Backend                                             │
│  • Route vers le bon agent                                                  │
│  • Retourne les réponses                                                   │
│                                                                             │
│  4️⃣ AGRÉGATION                                                             │
│  • Agrège les heartbeats des agents                                        │
│  • Réduit le trafic vers le Backend                                        │
│                                                                             │
│  5️⃣ RÉSILIENCE                                                             │
│  • Buffer si Backend indisponible                                          │
│  • Haute dispo possible (cluster de Gateways)                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Configuration Gateway

```yaml
# /etc/opsmap/gateway.yaml

gateway:
  # Identifiant unique de la Gateway
  id: "gateway-prod-paris-01"
  
  # Zone/environnement géré
  zone: "production"
  datacenter: "paris-dc1"
  
  # Labels
  labels:
    region: "eu-west"
    tier: "primary"

# Serveur pour les Agents (connexions entrantes depuis la zone)
agent_server:
  # Adresse d'écoute (interface interne)
  bind_address: "10.2.0.1:8443"
  
  # Nombre max de connexions agents simultanées
  max_connections: 1000
  
  # TLS serveur (les agents s'y connectent)
  tls:
    cert_file: "/etc/opsmap/certs/gateway.crt"
    key_file: "/etc/opsmap/certs/gateway.key"
    
    # CA qui a signé les certificats des agents
    client_ca_file: "/etc/opsmap/certs/agent-ca.crt"
    
    # mTLS obligatoire
    client_auth: required
    
    # Versions TLS
    min_version: "1.2"

# Client pour le Backend (connexion sortante vers Management)
backend_connection:
  # URL du Backend OpsMap
  url: "wss://opsmap-backend.management.internal:9443"
  
  # Fallback URLs
  fallback_urls:
    - "wss://opsmap-backend-2.management.internal:9443"
  
  # TLS client
  tls:
    cert_file: "/etc/opsmap/certs/gateway-client.crt"
    key_file: "/etc/opsmap/certs/gateway-client.key"
    ca_file: "/etc/opsmap/certs/backend-ca.crt"
  
  # Reconnexion
  reconnect:
    initial_delay_ms: 1000
    max_delay_ms: 30000
    multiplier: 2.0
  
  # Heartbeat vers Backend
  heartbeat_interval_secs: 30

# Registre des agents
agent_registry:
  # Timeout avant de considérer un agent offline
  agent_timeout_secs: 90
  
  # Intervalle de cleanup des agents disparus
  cleanup_interval_secs: 300
  
  # Persistence du registre (optionnel, pour restart rapide)
  persistence:
    enabled: true
    file: "/var/lib/opsmap/gateway/registry.json"

# Routage
routing:
  # Timeout pour les commandes
  command_timeout_secs: 300
  
  # Retry sur erreur réseau
  retry_on_network_error: true
  max_retries: 3
  
  # File d'attente des commandes
  command_queue_size: 10000

# Agrégation
aggregation:
  # Agrège les heartbeats avant de les envoyer au Backend
  heartbeat_aggregation_secs: 10
  
  # Batch les events de discovery
  discovery_batch_size: 100
  discovery_batch_timeout_ms: 5000

# Buffer (si Backend down)
buffer:
  enabled: true
  path: "/var/lib/opsmap/gateway/buffer"
  max_size_mb: 500

# Haute disponibilité (optionnel)
ha:
  enabled: false
  # Mode: active-passive ou active-active
  mode: "active-passive"
  # Peers
  peers:
    - "wss://gateway-prod-paris-02.internal:8443"
  # Élection de leader
  election_timeout_ms: 5000

# Métriques
metrics:
  enabled: true
  bind_address: "127.0.0.1:9091"
  path: "/metrics"

# Logging
logging:
  level: "info"
  file: "/var/log/opsmap/gateway.log"
  max_size_mb: 100
  max_files: 10
  format: "json"
```

---

## 4. Modèle d'Exécution des Commandes

### 4.1 Principes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MODÈLE D'EXÉCUTION DES COMMANDES                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  L'agent doit gérer deux types de commandes très différents:               │
│                                                                             │
│  1️⃣ COMMANDES SYNCHRONES (bloquantes, rapides)                             │
│  ───────────────────────────────────────────────                            │
│  • Check/Healthcheck (status d'un service, fichier, port)                  │
│  • Commandes natives (disk_space, memory, cpu, etc.)                       │
│  • Timeout strict: 5-60 secondes max                                       │
│  • L'agent attend le résultat et le retourne immédiatement                 │
│                                                                             │
│  Flow:                                                                      │
│  Backend ──▶ Gateway ──▶ Agent                                             │
│                              │ exécute (bloque max N sec)                  │
│                              ▼                                              │
│  Backend ◀── Gateway ◀── Agent (résultat immédiat)                         │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────     │
│                                                                             │
│  2️⃣ COMMANDES ASYNCHRONES (détachées, longues)                             │
│  ──────────────────────────────────────────────                             │
│  • Start (démarrage d'application, peut prendre minutes)                   │
│  • Stop (arrêt graceful, peut être long)                                   │
│  • Actions custom longues (backup, migration, déploiement)                 │
│  • L'agent lance en mode détaché et retourne immédiatement un job_id       │
│  • Le backend poll ensuite pour vérifier la complétion                     │
│                                                                             │
│  Flow:                                                                      │
│  Backend ──▶ Gateway ──▶ Agent                                             │
│                              │ lance en détaché (double-fork)              │
│                              ▼                                              │
│  Backend ◀── Gateway ◀── Agent: { status: "started", job_id: "xxx" }       │
│                                                                             │
│  Puis POLLING via Check:                                                   │
│  Backend ──▶ Agent: check_job("xxx")                                       │
│  Backend ◀── Agent: { status: "running" }                                  │
│    ... toutes les N secondes ...                                           │
│  Backend ◀── Agent: { status: "completed", checks_passed: true }           │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────     │
│                                                                             │
│  ⚠️  IMPORTANT: Les commandes de CHECK doivent rester RAPIDES              │
│  pour ne pas bloquer la chaîne de polling. Timeout max: 10 secondes.       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Types de Commandes

```rust
// src/agent/commands/types.rs

/// Mode d'exécution d'une commande
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum ExecutionMode {
    /// Synchrone: attend le résultat (timeout strict)
    Sync { 
        timeout_ms: u64,
    },
    
    /// Asynchrone: lance et retourne immédiatement un job_id
    /// Le backend poll ensuite pour le statut
    Async { 
        /// Critères pour considérer la commande "terminée avec succès"
        completion_check: CompletionCheck,
        /// Intervalle de polling suggéré
        poll_interval_ms: u64,
        /// Timeout global (abandon si pas complété)
        max_wait_ms: u64,
    },
}

/// Définit comment vérifier qu'une commande async est terminée
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum CompletionCheck {
    /// Vérifie qu'un processus avec ce nom/pattern tourne
    ProcessRunning { 
        process_name: String,
        /// Optionnel: vérifie aussi qu'il écoute sur ce port
        listening_port: Option<u16>,
    },
    
    /// Vérifie qu'un processus avec ce nom/pattern NE tourne PAS
    ProcessStopped {
        process_name: String,
    },
    
    /// Vérifie qu'un service systemd/windows est dans l'état attendu
    ServiceStatus { 
        service_name: String, 
        expected_status: ServiceState,  // Running, Stopped, etc.
    },
    
    /// Vérifie via HTTP healthcheck
    HttpHealthy { 
        url: String, 
        expected_status: u16,
        /// Optionnel: vérifie que le body contient cette string
        body_contains: Option<String>,
    },
    
    /// Vérifie qu'un fichier existe (ou n'existe plus)
    FileExists { 
        path: String, 
        should_exist: bool,
    },
    
    /// Vérifie qu'un port TCP est ouvert (ou fermé)
    PortOpen { 
        port: u16, 
        host: Option<String>,  // Default: localhost
        should_be_open: bool,
    },
    
    /// Vérifie le code retour d'une commande custom
    CustomCommand { 
        command: String,
        args: Vec<String>,
        expected_exit_code: i32,
    },
    
    /// Combinaison: TOUS les checks doivent passer
    All { 
        checks: Vec<CompletionCheck>,
    },
    
    /// Combinaison: AU MOINS UN check doit passer
    Any { 
        checks: Vec<CompletionCheck>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum ServiceState {
    Running,
    Stopped,
    Starting,
    Stopping,
    Failed,
    Unknown,
}
```

### 4.3 Implémentation Agent - Exécution Async

```rust
// src/agent/executor/async_executor.rs

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};

/// Tracking des jobs asynchrones
pub struct AsyncJobTracker {
    jobs: Arc<RwLock<HashMap<String, AsyncJob>>>,
    max_jobs: usize,
    job_retention_secs: u64,
}

#[derive(Clone, Debug)]
pub struct AsyncJob {
    pub job_id: String,
    pub request_id: String,
    pub command: CommandSpec,
    pub completion_check: CompletionCheck,
    pub started_at: DateTime<Utc>,
    pub pid: Option<u32>,
    pub log_file: Option<PathBuf>,
    pub status: AsyncJobStatus,
    pub last_check: Option<CheckResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum AsyncJobStatus {
    /// Le processus a été lancé, en attente de complétion
    Running,
    /// Le completion_check a réussi
    Completed,
    /// Le processus ou le check a échoué
    Failed { error: String },
    /// Timeout global dépassé
    Timeout,
}

impl AsyncJobTracker {
    pub fn new(max_jobs: usize, retention_secs: u64) -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            max_jobs,
            job_retention_secs: retention_secs,
        }
    }
    
    /// Enregistre un nouveau job
    pub async fn register(&self, job: AsyncJob) -> Result<(), TrackerError> {
        let mut jobs = self.jobs.write().await;
        
        // Cleanup des vieux jobs
        self.cleanup_old_jobs(&mut jobs);
        
        if jobs.len() >= self.max_jobs {
            return Err(TrackerError::TooManyJobs);
        }
        
        jobs.insert(job.job_id.clone(), job);
        Ok(())
    }
    
    /// Récupère un job par son ID
    pub async fn get(&self, job_id: &str) -> Option<AsyncJob> {
        let jobs = self.jobs.read().await;
        jobs.get(job_id).cloned()
    }
    
    /// Met à jour le statut d'un job
    pub async fn update_status(
        &self, 
        job_id: &str, 
        status: AsyncJobStatus,
        check_result: Option<CheckResult>
    ) {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            job.status = status;
            job.last_check = check_result;
        }
    }
    
    fn cleanup_old_jobs(&self, jobs: &mut HashMap<String, AsyncJob>) {
        let now = Utc::now();
        let retention = chrono::Duration::seconds(self.job_retention_secs as i64);
        
        jobs.retain(|_, job| {
            // Garde les jobs running
            if matches!(job.status, AsyncJobStatus::Running) {
                return true;
            }
            // Supprime les jobs terminés après retention
            now.signed_duration_since(job.started_at) < retention
        });
    }
}

impl Agent {
    /// Exécute une commande asynchrone
    pub async fn execute_async(
        &self,
        request: CommandRequest,
        completion_check: CompletionCheck,
        poll_interval_ms: u64,
    ) -> CommandResponse {
        // Génère un job_id unique
        let job_id = format!("job_{}", uuid::Uuid::new_v4());
        
        // Lance le processus en mode DÉTACHÉ (double-fork)
        // Le processus survit au crash de l'agent
        let launch_result = self.detached_executor.spawn_detached(
            &request.command,
            request.run_as_user.as_deref(),
        ).await;
        
        match launch_result {
            Ok(process_info) => {
                // Enregistre le job pour tracking
                let job = AsyncJob {
                    job_id: job_id.clone(),
                    request_id: request.request_id.clone(),
                    command: request.command.clone(),
                    completion_check,
                    started_at: Utc::now(),
                    pid: process_info.pid,
                    log_file: Some(process_info.log_file),
                    status: AsyncJobStatus::Running,
                    last_check: None,
                };
                
                if let Err(e) = self.job_tracker.register(job).await {
                    return CommandResponse::Error {
                        request_id: request.request_id,
                        error: format!("Failed to track job: {}", e),
                    };
                }
                
                CommandResponse::AsyncStarted {
                    request_id: request.request_id,
                    job_id,
                    pid: process_info.pid,
                    started_at: Utc::now(),
                    suggested_poll_interval_ms: poll_interval_ms,
                }
            }
            Err(e) => {
                CommandResponse::Error {
                    request_id: request.request_id,
                    error: format!("Failed to launch process: {}", e),
                }
            }
        }
    }
    
    /// Vérifie le statut d'un job async (appelé lors du polling)
    pub async fn check_job_status(&self, job_id: &str) -> CommandResponse {
        // Récupère le job
        let job = match self.job_tracker.get(job_id).await {
            Some(j) => j,
            None => {
                return CommandResponse::AsyncStatus {
                    job_id: job_id.to_string(),
                    status: AsyncJobStatus::Failed { 
                        error: "Job not found (expired or unknown)".to_string() 
                    },
                    check_result: None,
                    elapsed_ms: 0,
                };
            }
        };
        
        // Si déjà terminé, retourne le statut
        if !matches!(job.status, AsyncJobStatus::Running) {
            return CommandResponse::AsyncStatus {
                job_id: job_id.to_string(),
                status: job.status.clone(),
                check_result: job.last_check.clone(),
                elapsed_ms: self.elapsed_ms(&job),
            };
        }
        
        // Exécute le completion check
        let check_result = self.execute_completion_check(&job.completion_check).await;
        
        let new_status = if check_result.passed {
            AsyncJobStatus::Completed
        } else if let Some(pid) = job.pid {
            // Vérifie si le processus tourne encore
            if self.is_process_alive(pid).await {
                AsyncJobStatus::Running
            } else {
                // Processus mort mais check pas passé = échec
                AsyncJobStatus::Failed {
                    error: format!(
                        "Process exited but completion check failed: {:?}",
                        check_result.details
                    ),
                }
            }
        } else {
            // Pas de PID, on se base uniquement sur le check
            AsyncJobStatus::Running
        };
        
        // Met à jour le tracker
        self.job_tracker.update_status(
            job_id, 
            new_status.clone(), 
            Some(check_result.clone())
        ).await;
        
        CommandResponse::AsyncStatus {
            job_id: job_id.to_string(),
            status: new_status,
            check_result: Some(check_result),
            elapsed_ms: self.elapsed_ms(&job),
        }
    }
    
    /// Exécute un completion check (DOIT être rapide, timeout 10s)
    async fn execute_completion_check(&self, check: &CompletionCheck) -> CheckResult {
        let timeout = Duration::from_secs(10);
        
        match tokio::time::timeout(timeout, self.do_check(check)).await {
            Ok(result) => result,
            Err(_) => CheckResult {
                check_type: "timeout".to_string(),
                passed: false,
                details: json!({ "error": "Check timed out after 10s" }),
                checked_at: Utc::now(),
            },
        }
    }
    
    async fn do_check(&self, check: &CompletionCheck) -> CheckResult {
        match check {
            CompletionCheck::ServiceStatus { service_name, expected_status } => {
                let actual = self.native_commands.service_status(service_name).await;
                let passed = actual.as_ref().map(|s| s == expected_status).unwrap_or(false);
                
                CheckResult {
                    check_type: "service_status".to_string(),
                    passed,
                    details: json!({
                        "service": service_name,
                        "expected": expected_status,
                        "actual": actual,
                    }),
                    checked_at: Utc::now(),
                }
            }
            
            CompletionCheck::PortOpen { port, host, should_be_open } => {
                let host = host.as_deref().unwrap_or("127.0.0.1");
                let is_open = self.native_commands.check_port(host, *port).await;
                let passed = is_open == *should_be_open;
                
                CheckResult {
                    check_type: "port_open".to_string(),
                    passed,
                    details: json!({
                        "host": host,
                        "port": port,
                        "should_be_open": should_be_open,
                        "is_open": is_open,
                    }),
                    checked_at: Utc::now(),
                }
            }
            
            CompletionCheck::HttpHealthy { url, expected_status, body_contains } => {
                let result = self.native_commands.http_check(url, Duration::from_secs(5)).await;
                
                let passed = match &result {
                    Ok(resp) => {
                        let status_ok = resp.status == *expected_status;
                        let body_ok = body_contains.as_ref()
                            .map(|s| resp.body.contains(s))
                            .unwrap_or(true);
                        status_ok && body_ok
                    }
                    Err(_) => false,
                };
                
                CheckResult {
                    check_type: "http_healthy".to_string(),
                    passed,
                    details: json!({
                        "url": url,
                        "expected_status": expected_status,
                        "result": result.map(|r| json!({
                            "status": r.status,
                            "latency_ms": r.latency_ms,
                        })).ok(),
                    }),
                    checked_at: Utc::now(),
                }
            }
            
            CompletionCheck::ProcessRunning { process_name, listening_port } => {
                let process = self.native_commands.find_process(process_name).await;
                let process_found = process.is_some();
                
                let port_ok = match listening_port {
                    Some(port) => self.native_commands.check_port("127.0.0.1", *port).await,
                    None => true,
                };
                
                CheckResult {
                    check_type: "process_running".to_string(),
                    passed: process_found && port_ok,
                    details: json!({
                        "process_name": process_name,
                        "process_found": process_found,
                        "pid": process.map(|p| p.pid),
                        "listening_port": listening_port,
                        "port_open": port_ok,
                    }),
                    checked_at: Utc::now(),
                }
            }
            
            CompletionCheck::ProcessStopped { process_name } => {
                let process = self.native_commands.find_process(process_name).await;
                
                CheckResult {
                    check_type: "process_stopped".to_string(),
                    passed: process.is_none(),
                    details: json!({
                        "process_name": process_name,
                        "still_running": process.is_some(),
                        "pid": process.map(|p| p.pid),
                    }),
                    checked_at: Utc::now(),
                }
            }
            
            CompletionCheck::FileExists { path, should_exist } => {
                let exists = tokio::fs::metadata(path).await.is_ok();
                
                CheckResult {
                    check_type: "file_exists".to_string(),
                    passed: exists == *should_exist,
                    details: json!({
                        "path": path,
                        "should_exist": should_exist,
                        "exists": exists,
                    }),
                    checked_at: Utc::now(),
                }
            }
            
            CompletionCheck::All { checks } => {
                let mut results = Vec::new();
                let mut all_passed = true;
                
                for sub_check in checks {
                    let result = Box::pin(self.do_check(sub_check)).await;
                    if !result.passed {
                        all_passed = false;
                    }
                    results.push(result);
                }
                
                CheckResult {
                    check_type: "all".to_string(),
                    passed: all_passed,
                    details: json!({ "sub_checks": results }),
                    checked_at: Utc::now(),
                }
            }
            
            CompletionCheck::Any { checks } => {
                let mut results = Vec::new();
                let mut any_passed = false;
                
                for sub_check in checks {
                    let result = Box::pin(self.do_check(sub_check)).await;
                    if result.passed {
                        any_passed = true;
                    }
                    results.push(result);
                }
                
                CheckResult {
                    check_type: "any".to_string(),
                    passed: any_passed,
                    details: json!({ "sub_checks": results }),
                    checked_at: Utc::now(),
                }
            }
            
            CompletionCheck::CustomCommand { command, args, expected_exit_code } => {
                let result = self.detached_executor.spawn_and_wait(
                    command,
                    args,
                    Duration::from_secs(10),
                    None,
                ).await;
                
                let passed = result.as_ref()
                    .map(|r| r.exit_code == *expected_exit_code)
                    .unwrap_or(false);
                
                CheckResult {
                    check_type: "custom_command".to_string(),
                    passed,
                    details: json!({
                        "command": command,
                        "expected_exit_code": expected_exit_code,
                        "result": result.ok(),
                    }),
                    checked_at: Utc::now(),
                }
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckResult {
    pub check_type: String,
    pub passed: bool,
    pub details: serde_json::Value,
    pub checked_at: DateTime<Utc>,
}
```

### 4.4 Backend - Orchestration du Polling

```typescript
// src/backend/core/command-orchestrator.ts

import { EventEmitter } from 'events';

interface ExecutionMode {
  type: 'sync' | 'async';
  timeout?: number;
  completionCheck?: CompletionCheck;
  pollInterval?: number;
  maxWaitTime?: number;
}

interface ActiveJob {
  jobId: string;
  agentId: string;
  command: CommandSpec;
  startedAt: Date;
  completionCheck: CompletionCheck;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  lastCheck?: CheckResult;
}

export class CommandOrchestrator extends EventEmitter {
  private activeJobs: Map<string, ActiveJob> = new Map();
  private pollingIntervals: Map<string, NodeJS.Timer> = new Map();
  
  constructor(
    private gatewayManager: GatewayConnectionManager,
    private fsmManager: FSMManager,
  ) {
    super();
  }
  
  /**
   * Exécute une commande sur un agent
   * Détermine automatiquement le mode sync/async
   */
  async executeCommand(
    agentId: string,
    command: CommandSpec,
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    const mode = this.determineExecutionMode(command, options);
    
    if (mode.type === 'sync') {
      return this.executeSyncCommand(agentId, command, mode.timeout!);
    } else {
      return this.executeAsyncCommand(agentId, command, mode);
    }
  }
  
  /**
   * Détermine automatiquement le mode d'exécution
   */
  private determineExecutionMode(
    command: CommandSpec,
    options: CommandOptions
  ): ExecutionMode {
    // Override explicite
    if (options.executionMode) {
      return options.executionMode;
    }
    
    // Commandes toujours SYNC (rapides)
    const syncCommands = [
      'native.*',           // Toutes les commandes natives
      'service.status',     // Juste le status, pas start/stop
      'file.exists',
      'file.read',
      'file.checksum',
      'port.check',
      'http.check',
      'process.list',
      'process.info',
      'discovery.*',
    ];
    
    // Commandes toujours ASYNC (potentiellement longues)
    const asyncCommands = [
      'service.start',
      'service.stop',
      'service.restart',
      'execute',            // Exécution de script/binaire
      'action.*',           // Actions custom
    ];
    
    const cmdType = this.getCommandType(command);
    
    if (this.matchesAny(cmdType, syncCommands)) {
      return {
        type: 'sync',
        timeout: options.timeout || 30000,
      };
    }
    
    if (this.matchesAny(cmdType, asyncCommands)) {
      return {
        type: 'async',
        completionCheck: options.completionCheck || this.inferCompletionCheck(command),
        pollInterval: options.pollInterval || 2000,
        maxWaitTime: options.maxWaitTime || 300000,  // 5 min par défaut
      };
    }
    
    // Défaut: sync avec timeout généreux
    return {
      type: 'sync',
      timeout: options.timeout || 60000,
    };
  }
  
  /**
   * Infère le check de complétion basé sur la commande
   */
  private inferCompletionCheck(command: CommandSpec): CompletionCheck {
    // Pour service.start → vérifier que le service est "running"
    if (command.type === 'service.start') {
      return {
        type: 'service_status',
        service_name: command.serviceName,
        expected_status: 'running',
      };
    }
    
    // Pour service.stop → vérifier que le service est "stopped"
    if (command.type === 'service.stop') {
      return {
        type: 'service_status',
        service_name: command.serviceName,
        expected_status: 'stopped',
      };
    }
    
    // Pour execute avec healthcheck défini dans la Map
    if (command.healthcheck) {
      return this.convertHealthcheckToCompletionCheck(command.healthcheck);
    }
    
    // Défaut: vérifie juste que le processus tourne (ou pas)
    if (command.type === 'service.start' || command.type === 'execute') {
      return {
        type: 'process_running',
        process_name: command.processName || command.name,
      };
    }
    
    return {
      type: 'process_stopped',
      process_name: command.processName || command.name,
    };
  }
  
  /**
   * Exécute une commande SYNC (bloquante)
   */
  private async executeSyncCommand(
    agentId: string,
    command: CommandSpec,
    timeout: number
  ): Promise<CommandResult> {
    const requestId = this.generateRequestId();
    
    const response = await this.gatewayManager.sendToAgent(agentId, {
      type: 'command',
      request_id: requestId,
      command,
      execution_mode: { type: 'sync', timeout_ms: timeout },
    });
    
    return {
      success: response.success,
      result: response.result,
      duration_ms: response.duration_ms,
    };
  }
  
  /**
   * Exécute une commande ASYNC avec polling
   */
  private async executeAsyncCommand(
    agentId: string,
    command: CommandSpec,
    mode: ExecutionMode
  ): Promise<CommandResult> {
    const requestId = this.generateRequestId();
    
    // 1. Lance la commande (retourne immédiatement avec job_id)
    const launchResponse = await this.gatewayManager.sendToAgent(agentId, {
      type: 'command',
      request_id: requestId,
      command,
      execution_mode: {
        type: 'async',
        completion_check: mode.completionCheck,
        poll_interval_ms: mode.pollInterval,
      },
    });
    
    if (launchResponse.type !== 'async_started') {
      return {
        success: false,
        error: launchResponse.error || 'Failed to start async command',
      };
    }
    
    const jobId = launchResponse.job_id;
    
    // 2. Enregistre le job actif
    const job: ActiveJob = {
      jobId,
      agentId,
      command,
      startedAt: new Date(),
      completionCheck: mode.completionCheck!,
      status: 'running',
    };
    this.activeJobs.set(jobId, job);
    
    // 3. Émet événement pour UI temps réel
    this.emit('job:started', {
      jobId,
      agentId,
      command: command.type,
      startedAt: job.startedAt,
    });
    
    // 4. Démarre le polling
    return this.pollUntilComplete(jobId, mode);
  }
  
  /**
   * Poll jusqu'à complétion, échec ou timeout
   */
  private async pollUntilComplete(
    jobId: string,
    mode: ExecutionMode
  ): Promise<CommandResult> {
    const job = this.activeJobs.get(jobId)!;
    const startTime = Date.now();
    const maxWait = mode.maxWaitTime || 300000;
    const pollInterval = mode.pollInterval || 2000;
    
    return new Promise((resolve) => {
      const poll = async () => {
        const elapsed = Date.now() - startTime;
        
        // Check timeout global
        if (elapsed > maxWait) {
          this.cleanupJob(jobId);
          this.emit('job:timeout', { jobId, elapsed });
          
          resolve({
            success: false,
            error: `Timeout after ${elapsed}ms waiting for completion`,
            elapsed_ms: elapsed,
          });
          return;
        }
        
        try {
          // Poll le statut auprès de l'agent
          const status = await this.gatewayManager.sendToAgent(job.agentId, {
            type: 'check_job_status',
            job_id: jobId,
          });
          
          // Met à jour le job
          job.lastCheck = status.check_result;
          this.emit('job:poll', { jobId, status });
          
          if (status.status === 'completed') {
            this.cleanupJob(jobId);
            this.emit('job:completed', { 
              jobId, 
              elapsed: Date.now() - startTime,
              checkResult: status.check_result,
            });
            
            resolve({
              success: true,
              elapsed_ms: Date.now() - startTime,
              check_result: status.check_result,
            });
            return;
          }
          
          if (status.status === 'failed') {
            this.cleanupJob(jobId);
            this.emit('job:failed', { 
              jobId, 
              error: status.error,
              checkResult: status.check_result,
            });
            
            resolve({
              success: false,
              error: status.error,
              elapsed_ms: Date.now() - startTime,
              check_result: status.check_result,
            });
            return;
          }
          
          // Status = 'running' → continue polling
          setTimeout(poll, pollInterval);
          
        } catch (error) {
          // Erreur réseau, retry
          console.error(`Poll error for job ${jobId}:`, error);
          setTimeout(poll, pollInterval);
        }
      };
      
      // Premier poll après l'intervalle
      setTimeout(poll, pollInterval);
    });
  }
  
  /**
   * Annule un job en cours
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.activeJobs.get(jobId);
    if (!job) return false;
    
    // Optionnel: envoyer signal kill à l'agent
    // (mais le processus est détaché, donc peut continuer)
    
    this.cleanupJob(jobId);
    this.emit('job:cancelled', { jobId });
    
    return true;
  }
  
  private cleanupJob(jobId: string) {
    this.activeJobs.delete(jobId);
    const interval = this.pollingIntervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(jobId);
    }
  }
  
  /**
   * Récupère les jobs actifs (pour monitoring)
   */
  getActiveJobs(): ActiveJob[] {
    return Array.from(this.activeJobs.values());
  }
}
```

### 4.5 Configuration dans les Maps YAML

```yaml
# production/trading-platform/components/trading-api.yaml
apiVersion: opsmap.io/v1
kind: Component
metadata:
  name: trading-api
  
spec:
  type: service
  host: srv-trading-01
  
  commands:
    # ══════════════════════════════════════════════════════════════
    # START - Commande ASYNC avec completion checks multiples
    # ══════════════════════════════════════════════════════════════
    start:
      command: "systemctl start trading-api"
      
      execution:
        mode: async
        
        # Tous ces checks doivent passer pour considérer le start "réussi"
        completion_check:
          type: all
          checks:
            # 1. Le service systemd doit être "running"
            - type: service_status
              service_name: trading-api
              expected_status: running
              
            # 2. Le port 8080 doit être ouvert
            - type: port_open
              port: 8080
              should_be_open: true
              
            # 3. Le healthcheck HTTP doit répondre 200
            - type: http_healthy
              url: "http://localhost:8080/health"
              expected_status: 200
              body_contains: '"status":"UP"'  # Optionnel
        
        # Polling toutes les 2 secondes
        poll_interval_ms: 2000
        
        # Timeout global: 2 minutes pour démarrer
        max_wait_ms: 120000
    
    # ══════════════════════════════════════════════════════════════
    # STOP - Commande ASYNC avec vérification arrêt complet
    # ══════════════════════════════════════════════════════════════
    stop:
      command: "systemctl stop trading-api"
      
      execution:
        mode: async
        
        completion_check:
          type: all
          checks:
            # 1. Service systemd arrêté
            - type: service_status
              service_name: trading-api
              expected_status: stopped
              
            # 2. Port 8080 fermé (libéré)
            - type: port_open
              port: 8080
              should_be_open: false
              
            # 3. Processus java disparu
            - type: process_stopped
              process_name: "trading-api"
        
        poll_interval_ms: 1000
        max_wait_ms: 60000
    
    # ══════════════════════════════════════════════════════════════
    # STATUS - Commande SYNC (rapide)
    # ══════════════════════════════════════════════════════════════
    status:
      command: "systemctl is-active trading-api"
      
      execution:
        mode: sync
        timeout_ms: 5000
    
    # ══════════════════════════════════════════════════════════════
    # RESTART - Combo stop + start
    # ══════════════════════════════════════════════════════════════
    restart:
      command: "systemctl restart trading-api"
      
      execution:
        mode: async
        
        # Même checks que start
        completion_check:
          type: all
          checks:
            - type: service_status
              service_name: trading-api
              expected_status: running
            - type: port_open
              port: 8080
              should_be_open: true
            - type: http_healthy
              url: "http://localhost:8080/health"
              expected_status: 200
        
        poll_interval_ms: 2000
        max_wait_ms: 180000  # 3 min (stop + start)
  
  # ══════════════════════════════════════════════════════════════
  # HEALTHCHECK PÉRIODIQUE (toujours sync, rapide)
  # ══════════════════════════════════════════════════════════════
  healthcheck:
    type: http
    url: "http://localhost:8080/health"
    expected_status: 200
    
    # Exécuté toutes les 30 secondes
    interval_ms: 30000
    
    # Timeout strict: 10 secondes max
    timeout_ms: 10000
    
    # Nombre d'échecs consécutifs avant de marquer "unhealthy"
    failure_threshold: 3
```

### 4.6 Flow Complet Illustré

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLOW COMPLET: START trading-api                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  T+0ms     User clique "Start" sur trading-api                             │
│            │                                                                │
│            ▼                                                                │
│  T+10ms    Backend lit la Map → trouve execution.mode = async              │
│            Backend lit completion_check (service + port + http)            │
│            │                                                                │
│            ▼                                                                │
│  T+50ms    Backend → Gateway → Agent:                                      │
│            {                                                                │
│              type: "command",                                               │
│              command: "systemctl start trading-api",                       │
│              execution_mode: {                                              │
│                type: "async",                                               │
│                completion_check: { ... }                                   │
│              }                                                              │
│            }                                                                │
│            │                                                                │
│            ▼                                                                │
│  T+100ms   Agent: Lance "systemctl start" en DOUBLE-FORK (détaché)         │
│            Agent: Enregistre job_id = "job_abc123"                         │
│            Agent → Gateway → Backend:                                      │
│            { type: "async_started", job_id: "job_abc123" }                 │
│            │                                                                │
│            ▼                                                                │
│  T+150ms   Backend: Enregistre le job actif                                │
│            Backend → Frontend (WebSocket):                                 │
│            { event: "job_started", component: "trading-api" }              │
│            │                                                                │
│            ▼                                                                │
│  T+2000ms  Backend: Premier POLL                                           │
│            Backend → Agent: { type: "check_job_status", job_id: "..." }    │
│            Agent: Exécute les 3 checks:                                    │
│              - service_status: "starting" ❌                               │
│              - port 8080: closed ❌                                        │
│              - http /health: connection refused ❌                         │
│            Agent → Backend: { status: "running", checks: [...] }           │
│            │                                                                │
│            ▼                                                                │
│  T+4000ms  Backend: Deuxième POLL                                          │
│            Agent checks:                                                    │
│              - service_status: "running" ✅                                │
│              - port 8080: closed ❌                                        │
│              - http /health: connection refused ❌                         │
│            Agent → Backend: { status: "running" }                          │
│            │                                                                │
│            ▼                                                                │
│  T+6000ms  Backend: Troisième POLL                                         │
│            Agent checks:                                                    │
│              - service_status: "running" ✅                                │
│              - port 8080: open ✅                                          │
│              - http /health: 200 OK ✅                                     │
│            Agent → Backend: { status: "completed", all_passed: true }      │
│            │                                                                │
│            ▼                                                                │
│  T+6050ms  Backend: Job terminé avec succès !                              │
│            Backend: Met à jour FSM → état "Running"                        │
│            Backend → Frontend (WebSocket):                                 │
│            { event: "job_completed", component: "trading-api",             │
│              status: "running", duration_ms: 6000 }                        │
│            │                                                                │
│            ▼                                                                │
│  T+6100ms  Frontend: Affiche ✅ trading-api: Running (démarré en 6s)       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Protocole de Communication

### 5.1 Messages Agent ↔ Gateway

```rust
// Définition des messages (serde JSON)

// === Agent → Gateway ===

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentToGateway {
    // Enregistrement initial
    Register {
        agent_id: String,
        hostname: String,
        os: OsInfo,
        labels: HashMap<String, String>,
        capabilities: Vec<String>,
        version: String,
    },
    
    // Heartbeat périodique
    Heartbeat {
        agent_id: String,
        uptime_secs: u64,
        load: [f32; 3],
        memory_percent: f32,
        active_commands: u32,
    },
    
    // Résultat de commande
    CommandResult {
        request_id: String,
        success: bool,
        result: serde_json::Value,
        error: Option<String>,
        duration_ms: u64,
    },
    
    // Résultat de discovery
    DiscoveryResult {
        discovery_id: String,
        services: Vec<DiscoveredService>,
        processes: Vec<DiscoveredProcess>,
        ports: Vec<DiscoveredPort>,
    },
    
    // Log/Event
    Event {
        event_id: String,
        event_type: String,
        timestamp: DateTime<Utc>,
        data: serde_json::Value,
    },
}

// === Gateway → Agent ===

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GatewayToAgent {
    // Confirmation d'enregistrement
    Registered {
        session_id: String,
        server_time: DateTime<Utc>,
        config_update: Option<AgentConfigUpdate>,
    },
    
    // Commande à exécuter
    Command {
        request_id: String,
        command: CommandSpec,
        timeout_ms: u64,
    },
    
    // Demande de discovery
    Discover {
        discovery_id: String,
        discover_types: Vec<String>,
    },
    
    // Ping (keepalive)
    Ping {
        timestamp: DateTime<Utc>,
    },
    
    // Mise à jour de config
    ConfigUpdate {
        config: AgentConfigUpdate,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CommandSpec {
    // Commande native
    Native {
        name: String,
        params: HashMap<String, serde_json::Value>,
    },
    
    // Script/Shell
    Script {
        content: String,
        interpreter: Option<String>,  // /bin/bash, python3, etc.
        args: Vec<String>,
        env: HashMap<String, String>,
        working_dir: Option<String>,
        run_as_user: Option<String>,
    },
    
    // Exécutable
    Execute {
        path: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        working_dir: Option<String>,
        run_as_user: Option<String>,
        detached: bool,  // Si true, utilise double-fork
    },
    
    // Contrôle de service
    ServiceControl {
        service_name: String,
        action: ServiceAction,  // Start, Stop, Restart, Status
    },
}
```

### 4.2 Messages Gateway ↔ Backend

```rust
// === Gateway → Backend ===

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GatewayToBackend {
    // Enregistrement de la Gateway
    GatewayRegister {
        gateway_id: String,
        zone: String,
        labels: HashMap<String, String>,
        version: String,
    },
    
    // Agent connecté
    AgentOnline {
        gateway_id: String,
        agent: AgentInfo,
    },
    
    // Agent déconnecté
    AgentOffline {
        gateway_id: String,
        agent_id: String,
        reason: String,
    },
    
    // Heartbeat agrégé
    AggregatedHeartbeat {
        gateway_id: String,
        agents: Vec<AgentHeartbeatSummary>,
        timestamp: DateTime<Utc>,
    },
    
    // Résultat de commande (forwarded)
    CommandResult {
        request_id: String,
        agent_id: String,
        result: serde_json::Value,
    },
    
    // Discovery results (batched)
    DiscoveryBatch {
        gateway_id: String,
        discoveries: Vec<AgentDiscoveryResult>,
    },
}

// === Backend → Gateway ===

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BackendToGateway {
    // Confirmation enregistrement
    GatewayRegistered {
        session_id: String,
    },
    
    // Commande pour un agent
    Command {
        request_id: String,
        target_agent: String,
        command: CommandSpec,
        timeout_ms: u64,
    },
    
    // Commande broadcast (tous les agents d'un filtre)
    BroadcastCommand {
        request_id: String,
        filter: AgentFilter,
        command: CommandSpec,
        timeout_ms: u64,
    },
    
    // Demande de discovery
    TriggerDiscovery {
        discovery_id: String,
        target_agents: Vec<String>,  // Vide = tous
        discover_types: Vec<String>,
    },
    
    // Config update pour agents
    PushAgentConfig {
        target_agents: Vec<String>,
        config: AgentConfigUpdate,
    },
}

#[derive(Serialize, Deserialize)]
pub struct AgentFilter {
    pub labels: HashMap<String, String>,
    pub hostname_pattern: Option<String>,
    pub agent_ids: Option<Vec<String>>,
}
```

---

## 5. PKI et Certificats

### 5.1 Structure PKI

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PKI HIERARCHY                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                         ┌─────────────────────┐                             │
│                         │      ROOT CA        │                             │
│                         │   (Offline, HSM)    │                             │
│                         │   Validity: 20 ans  │                             │
│                         └──────────┬──────────┘                             │
│                                    │                                        │
│          ┌─────────────────────────┼─────────────────────────┐             │
│          │                         │                         │              │
│          ▼                         ▼                         ▼              │
│  ┌───────────────┐        ┌───────────────┐        ┌───────────────┐       │
│  │  Backend CA   │        │  Gateway CA   │        │   Agent CA    │       │
│  │ (Intermediate)│        │ (Intermediate)│        │ (Intermediate)│       │
│  │ Validity: 5ans│        │ Validity: 5ans│        │ Validity: 5ans│       │
│  └───────┬───────┘        └───────┬───────┘        └───────┬───────┘       │
│          │                        │                        │                │
│          ▼                        ▼                        ▼                │
│  ┌───────────────┐        ┌───────────────┐        ┌───────────────┐       │
│  │ backend.crt   │        │ gateway-*.crt │        │ agent-*.crt   │       │
│  │ Validity: 1an │        │ Validity: 1an │        │ Validity: 1an │       │
│  │               │        │               │        │               │       │
│  │ CN=opsmap-    │        │ CN=gateway-   │        │ CN=agent-     │       │
│  │    backend    │        │   prod-paris  │        │   srv-db-01   │       │
│  │               │        │               │        │               │       │
│  │ SAN:          │        │ SAN:          │        │ SAN:          │       │
│  │ - DNS:backend │        │ - DNS:gw-prod │        │ - DNS:srv-db  │       │
│  │ - IP:10.0.0.5 │        │ - IP:10.2.0.1 │        │ - IP:10.2.1.5 │       │
│  └───────────────┘        └───────────────┘        └───────────────┘       │
│                                                                             │
│  VALIDATION CROISÉE:                                                        │
│  • Backend vérifie Gateways avec Gateway CA                                │
│  • Gateways vérifient Backend avec Backend CA                              │
│  • Gateways vérifient Agents avec Agent CA                                 │
│  • Agents vérifient Gateways avec Gateway CA                               │
│                                                                             │
│  ROTATION:                                                                  │
│  • Certificats finaux: renouvelés automatiquement avant expiration         │
│  • Intermediate CA: renouvelés manuellement tous les 4 ans                 │
│  • Root CA: Jamais (offline, HSM)                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Scripts de Génération

```bash
#!/bin/bash
# scripts/pki/generate-certs.sh

set -e

PKI_DIR="/opt/opsmap/pki"
mkdir -p "$PKI_DIR"/{root,intermediate,certs}

# === ROOT CA (faire UNE SEULE FOIS, garder offline) ===
generate_root_ca() {
    openssl genrsa -aes256 -out "$PKI_DIR/root/root-ca.key" 4096
    
    openssl req -new -x509 -days 7300 -sha512 \
        -key "$PKI_DIR/root/root-ca.key" \
        -out "$PKI_DIR/root/root-ca.crt" \
        -subj "/C=FR/O=OpsMap/CN=OpsMap Root CA"
}

# === INTERMEDIATE CAs ===
generate_intermediate_ca() {
    local name=$1  # backend-ca, gateway-ca, agent-ca
    
    # Génère clé
    openssl genrsa -out "$PKI_DIR/intermediate/${name}.key" 4096
    
    # CSR
    openssl req -new -sha384 \
        -key "$PKI_DIR/intermediate/${name}.key" \
        -out "$PKI_DIR/intermediate/${name}.csr" \
        -subj "/C=FR/O=OpsMap/CN=OpsMap ${name}"
    
    # Signe avec Root CA
    openssl x509 -req -days 1825 -sha384 \
        -in "$PKI_DIR/intermediate/${name}.csr" \
        -CA "$PKI_DIR/root/root-ca.crt" \
        -CAkey "$PKI_DIR/root/root-ca.key" \
        -CAcreateserial \
        -out "$PKI_DIR/intermediate/${name}.crt" \
        -extfile <(cat <<EOF
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
EOF
)
}

# === CERTIFICAT FINAL ===
generate_cert() {
    local name=$1       # srv-db-01
    local ca=$2         # agent-ca
    local dns=$3        # srv-db-01.internal
    local ip=$4         # 10.2.1.5
    
    # Génère clé
    openssl genrsa -out "$PKI_DIR/certs/${name}.key" 2048
    
    # CSR
    openssl req -new -sha256 \
        -key "$PKI_DIR/certs/${name}.key" \
        -out "$PKI_DIR/certs/${name}.csr" \
        -subj "/C=FR/O=OpsMap/CN=${name}"
    
    # Signe avec Intermediate CA
    openssl x509 -req -days 365 -sha256 \
        -in "$PKI_DIR/certs/${name}.csr" \
        -CA "$PKI_DIR/intermediate/${ca}.crt" \
        -CAkey "$PKI_DIR/intermediate/${ca}.key" \
        -CAcreateserial \
        -out "$PKI_DIR/certs/${name}.crt" \
        -extfile <(cat <<EOF
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = DNS:${dns}, IP:${ip}
EOF
)
    
    # Bundle avec chain
    cat "$PKI_DIR/certs/${name}.crt" \
        "$PKI_DIR/intermediate/${ca}.crt" \
        > "$PKI_DIR/certs/${name}-chain.crt"
}

# Génération
generate_intermediate_ca "backend-ca"
generate_intermediate_ca "gateway-ca"
generate_intermediate_ca "agent-ca"

# Exemple: certificat agent
generate_cert "agent-srv-db-01" "agent-ca" "srv-db-01.internal" "10.2.1.5"
```

---

## 6. Commandes Natives de l'Agent

### 6.1 Liste Complète

```rust
// src/agent/native_commands/mod.rs

/// Toutes les commandes natives supportées par l'agent
/// Ces commandes sont exécutées SANS shell, directement en Rust
/// = Plus rapide, plus sécurisé, pas d'injection possible

pub enum NativeCommand {
    // ═══════════════════════════════════════════════════════════
    // SYSTÈME
    // ═══════════════════════════════════════════════════════════
    
    /// Informations OS complètes
    OsInfo,
    // Retourne: { os_type, os_release, hostname, kernel, arch, uptime_secs }
    
    /// Espace disque tous filesystems
    DiskSpace,
    // Retourne: [{ mount, device, fs_type, total_gb, used_gb, avail_gb, pct }]
    
    /// Utilisation mémoire
    MemoryUsage,
    // Retourne: { total_mb, used_mb, free_mb, cached_mb, swap_total_mb, swap_used_mb }
    
    /// Charge CPU
    CpuLoad,
    // Retourne: { load_1m, load_5m, load_15m, cpu_count, cpu_usage_pct }
    
    /// Uptime système
    Uptime,
    // Retourne: { uptime_secs, boot_time }
    
    // ═══════════════════════════════════════════════════════════
    // RÉSEAU
    // ═══════════════════════════════════════════════════════════
    
    /// Liste interfaces réseau
    NetworkInterfaces,
    // Retourne: [{ name, mac, ipv4, ipv6, status, speed_mbps }]
    
    /// Test de port TCP
    PortCheck { host: String, port: u16, timeout_ms: u64 },
    // Retourne: { reachable: bool, latency_ms, error }
    
    /// Test HTTP(S)
    HttpCheck { 
        url: String, 
        method: Option<String>,
        expected_status: Option<u16>,
        timeout_ms: u64,
        insecure: bool,  // Skip TLS verify
    },
    // Retourne: { status_code, latency_ms, body_preview, headers }
    
    /// Résolution DNS
    DnsLookup { hostname: String },
    // Retourne: { addresses: [ip], ttl, resolved_in_ms }
    
    /// Ports en écoute
    ListeningPorts,
    // Retourne: [{ port, protocol, pid, process_name, address }]
    
    // ═══════════════════════════════════════════════════════════
    // PROCESSUS
    // ═══════════════════════════════════════════════════════════
    
    /// Liste tous les processus
    ProcessList,
    // Retourne: [{ pid, ppid, name, user, cpu_pct, mem_mb, status, cmd }]
    
    /// Info détaillée d'un processus
    ProcessInfo { pid: u32 },
    // Retourne: { pid, name, exe, cwd, env, open_files, connections, threads }
    
    /// Cherche processus par nom/pattern
    ProcessFind { pattern: String },
    // Retourne: [{ pid, name, cmd }]
    
    /// Kill un processus
    ProcessKill { pid: u32, signal: Option<i32> },
    // Retourne: { success: bool }
    
    // ═══════════════════════════════════════════════════════════
    // SERVICES (systemd Linux / SCM Windows)
    // ═══════════════════════════════════════════════════════════
    
    /// Statut d'un service
    ServiceStatus { name: String },
    // Retourne: { name, status, pid, enabled, description }
    
    /// Démarrer un service
    ServiceStart { name: String },
    // Retourne: { success: bool, message }
    
    /// Arrêter un service
    ServiceStop { name: String },
    // Retourne: { success: bool, message }
    
    /// Redémarrer un service
    ServiceRestart { name: String },
    // Retourne: { success: bool, message }
    
    /// Liste tous les services
    ServiceList,
    // Retourne: [{ name, status, enabled, description }]
    
    // ═══════════════════════════════════════════════════════════
    // FICHIERS
    // ═══════════════════════════════════════════════════════════
    
    /// Vérifie si un fichier/répertoire existe
    FileExists { path: String },
    // Retourne: { exists: bool, is_file: bool, is_dir: bool }
    
    /// Lit le contenu d'un fichier
    FileRead { path: String, max_bytes: Option<u64>, offset: Option<u64> },
    // Retourne: { content: String (ou base64 si binaire), size, truncated }
    
    /// Informations sur un fichier
    FileStat { path: String },
    // Retourne: { size, mode, uid, gid, mtime, atime, ctime }
    
    /// Checksum d'un fichier
    FileChecksum { path: String, algorithm: String },  // md5, sha256, sha512
    // Retourne: { checksum: String, algorithm }
    
    /// Liste le contenu d'un répertoire
    DirList { path: String, recursive: bool, max_depth: Option<u32> },
    // Retourne: [{ name, path, is_dir, size, mtime }]
    
    // ═══════════════════════════════════════════════════════════
    // DISCOVERY (Auto-découverte)
    // ═══════════════════════════════════════════════════════════
    
    /// Découvre les services installés
    DiscoverServices,
    // Retourne: [{ name, type, status, ports, dependencies }]
    
    /// Découvre les processus avec leurs ports
    DiscoverProcessesWithPorts,
    // Retourne: [{ pid, name, user, ports, connections }]
    
    /// Découvre les containers Docker
    DiscoverDocker,
    // Retourne: [{ id, name, image, status, ports }]
    
    /// Découvre les pods Kubernetes (si kubectl accessible)
    DiscoverKubernetes { namespace: Option<String> },
    // Retourne: [{ name, namespace, status, containers, node }]
}
```

---

## 7. Backend Node.js/TypeScript

### 7.1 Structure

```
opsmap-backend/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Entry point
│   │
│   ├── api/
│   │   ├── server.ts               # Express + Socket.io
│   │   ├── routes/
│   │   │   ├── applications.ts
│   │   │   ├── gateways.ts
│   │   │   ├── agents.ts
│   │   │   ├── maps.ts
│   │   │   ├── actions.ts
│   │   │   └── audit.ts
│   │   └── middleware/
│   │       ├── auth.ts             # OIDC/JWT
│   │       ├── rbac.ts             # Permissions
│   │       └── audit.ts            # Logging
│   │
│   ├── mcp/
│   │   ├── server.ts               # MCP Server
│   │   └── tools/                  # MCP Tools
│   │
│   ├── gateway/
│   │   ├── connection-manager.ts   # Gère connexions aux Gateways
│   │   ├── protocol.ts             # Messages Gateway
│   │   └── router.ts               # Route vers les bons agents
│   │
│   ├── core/
│   │   ├── application-manager.ts
│   │   ├── map-manager.ts
│   │   ├── fsm-manager.ts          # xcomponent-ai
│   │   └── config-loader.ts
│   │
│   ├── gitops/
│   │   ├── map-sync.ts             # Sync Git
│   │   ├── history.ts              # Historique
│   │   └── diff.ts                 # Diff viewer
│   │
│   ├── ai/
│   │   ├── connector-generator.ts  # Génère connecteurs via IA
│   │   └── insights.ts             # Prédictions, anomalies
│   │
│   └── analytics/
│       ├── prediction.ts           # Prédiction temps de démarrage
│       ├── anomaly.ts              # Détection anomalies
│       └── metrics.ts              # Agrégation métriques
│
└── tests/
```

---

## 8. Business Model Révisé

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OPSMAP BUSINESS MODEL - RÉVISÉ                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                    🆓 OPEN SOURCE (Apache 2.0)                        │ │
│  │                                                                       │ │
│  │  TOUT est open source:                                               │ │
│  │  • Backend complet                                                   │ │
│  │  • Agent Rust                                                        │ │
│  │  • Gateway Rust                                                      │ │
│  │  • Frontend React                                                    │ │
│  │  • AI Connector Generator (utilise ton API key)                     │ │
│  │  • Documentation                                                     │ │
│  │                                                                       │ │
│  │  → Self-hosted illimité, pas de limite artificielle                 │ │
│  │  → Fork autorisé, contributions bienvenues                          │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                    💰 MONÉTISATION                                    │ │
│  │                                                                       │ │
│  │  1️⃣ OPSMAP CLOUD (SaaS)                                              │ │
│  │     Prix: À partir de €99/mois                                       │ │
│  │     Valeur:                                                          │ │
│  │     • Zéro infrastructure à gérer                                    │ │
│  │     • Backup automatique                                             │ │
│  │     • Mises à jour automatiques                                      │ │
│  │     • Haute disponibilité                                            │ │
│  │     • Support inclus                                                 │ │
│  │                                                                       │ │
│  │  2️⃣ INTELLIGENCE COLLECTIVE (Data Network Effect)                    │ │
│  │     Gratuit en open source: Patterns de base                        │ │
│  │     Premium:                                                         │ │
│  │     • Patterns agrégés de milliers d'installations                  │ │
│  │     • "PostgreSQL 15 démarre en 12s en moyenne"                     │ │
│  │     • "Tomcat 9 sur RHEL 8: problèmes fréquents X, Y, Z"           │ │
│  │     • Suggestions auto-configuration                                 │ │
│  │                                                                       │ │
│  │  3️⃣ SUPPORT & SERVICES                                               │ │
│  │     • Support prioritaire: €500/mois                                │ │
│  │     • Consulting: €1500/jour                                        │ │
│  │     • Formation: €2000/session                                      │ │
│  │     • Custom development: Sur devis                                 │ │
│  │                                                                       │ │
│  │  4️⃣ MANAGED OPS (Co-géré ou Full-géré)                              │ │
│  │     Prix: Basé sur nombre de composants                             │ │
│  │     Valeur:                                                          │ │
│  │     • On surveille VOS applications                                 │ │
│  │     • On agit en cas de problème                                    │ │
│  │     • SLA avec pénalités                                            │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  DIFFÉRENCIATEUR: La valeur n'est pas dans le code (open source)           │
│  mais dans:                                                                 │
│  • Les DONNÉES (intelligence collective)                                   │
│  • L'INFRASTRUCTURE (SaaS managé)                                          │
│  • L'EXPERTISE (support, consulting)                                       │
│  • Le SERVICE (managed ops)                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Partage et Permissions (RBAC)

### 9.1 Modèle de Permissions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MODÈLE DE PERMISSIONS OPSMAP                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  HIÉRARCHIE DES OBJETS                                                     │
│  ═════════════════════                                                     │
│                                                                             │
│  Organization (Tenant)                                                      │
│       │                                                                     │
│       ├── Workspace (ex: "Production", "Development")                      │
│       │       │                                                             │
│       │       ├── Map (ex: "Trading Platform", "Payment Gateway")          │
│       │       │       │                                                     │
│       │       │       ├── Component (ex: "trading-api", "postgresql")      │
│       │       │       │       │                                             │
│       │       │       │       ├── Command (start, stop, restart)           │
│       │       │       │       └── Action (clear_cache, backup, etc.)       │
│       │       │       │                                                     │
│       │       │       └── Component Group (ex: "databases", "frontends")   │
│       │       │                                                             │
│       │       └── Map ...                                                  │
│       │                                                                     │
│       └── Workspace ...                                                    │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  PERMISSIONS GRANULAIRES                                                   │
│  ════════════════════════                                                  │
│                                                                             │
│  NIVEAU MAP:                                                               │
│  • map:view        → Voir la Map et ses composants                        │
│  • map:edit        → Modifier la structure de la Map                      │
│  • map:delete      → Supprimer la Map                                     │
│  • map:share       → Partager la Map avec d'autres utilisateurs           │
│  • map:admin       → Toutes les permissions sur la Map                    │
│                                                                             │
│  NIVEAU COMPOSANT:                                                         │
│  • component:view      → Voir le statut du composant                      │
│  • component:start     → Démarrer le composant                            │
│  • component:stop      → Arrêter le composant                             │
│  • component:restart   → Redémarrer le composant                          │
│  • component:edit      → Modifier la configuration du composant           │
│  • component:logs      → Voir les logs du composant                       │
│                                                                             │
│  NIVEAU ACTION CUSTOM:                                                     │
│  • action:{name}:execute   → Exécuter une action spécifique              │
│  • action:*:execute        → Exécuter toutes les actions                 │
│                                                                             │
│  NIVEAU WORKSPACE:                                                         │
│  • workspace:view      → Voir le workspace et ses Maps                    │
│  • workspace:create    → Créer des Maps dans le workspace                 │
│  • workspace:admin     → Gérer le workspace                               │
│                                                                             │
│  NIVEAU ORGANIZATION:                                                      │
│  • org:admin           → Super admin de l'organisation                    │
│  • org:users           → Gérer les utilisateurs                           │
│  • org:billing         → Gérer la facturation                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Rôles Prédéfinis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RÔLES PRÉDÉFINIS                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ VIEWER (Lecture seule)                                              │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ • Voir les Maps et composants                                       │   │
│  │ • Voir le statut en temps réel                                      │   │
│  │ • Voir l'historique et les logs                                     │   │
│  │ • Voir le graphe de dépendances                                     │   │
│  │                                                                     │   │
│  │ Permissions: map:view, component:view, component:logs              │   │
│  │ Cas d'usage: Stakeholders, managers, support L1                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ OPERATOR (Opérations)                                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ • Tout ce que VIEWER peut faire                                     │   │
│  │ • Démarrer/Arrêter/Redémarrer les composants                       │   │
│  │ • Exécuter les actions custom autorisées                           │   │
│  │ • Déclencher un "repair branch"                                    │   │
│  │                                                                     │   │
│  │ Permissions: map:view, component:*, action:*:execute               │   │
│  │ Cas d'usage: Ops, SRE, Support L2                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ EDITOR (Modification)                                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ • Tout ce que OPERATOR peut faire                                   │   │
│  │ • Modifier la structure de la Map                                   │   │
│  │ • Ajouter/Supprimer des composants                                 │   │
│  │ • Modifier les checks et commandes                                 │   │
│  │ • Créer des actions custom                                         │   │
│  │                                                                     │   │
│  │ Permissions: map:view, map:edit, component:*, action:*             │   │
│  │ Cas d'usage: DevOps, Tech Leads                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ADMIN (Administration de la Map)                                    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ • Tout ce que EDITOR peut faire                                     │   │
│  │ • Partager la Map avec d'autres utilisateurs                       │   │
│  │ • Modifier les permissions des utilisateurs sur la Map             │   │
│  │ • Supprimer la Map                                                 │   │
│  │ • Transférer la propriété                                          │   │
│  │                                                                     │   │
│  │ Permissions: map:admin                                              │   │
│  │ Cas d'usage: Propriétaire de la Map, Team Lead                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ RESTRICTED OPERATOR (Opérations limitées)                           │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ • Voir les Maps et composants                                       │   │
│  │ • Démarrer les composants UNIQUEMENT                               │   │
│  │ • PAS de stop (évite les erreurs)                                  │   │
│  │ • Actions custom spécifiques uniquement                            │   │
│  │                                                                     │   │
│  │ Permissions: map:view, component:view, component:start             │   │
│  │ Cas d'usage: Équipe métier, astreinte limitée                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 Partage de Maps

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PARTAGE DE MAPS                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  MÉTHODES DE PARTAGE                                                       │
│  ═══════════════════                                                       │
│                                                                             │
│  1️⃣ PARTAGE AVEC UN UTILISATEUR                                            │
│     • Inviter par email                                                    │
│     • Assigner un rôle (Viewer, Operator, Editor, Admin)                  │
│     • L'utilisateur voit la Map dans son dashboard                        │
│                                                                             │
│  2️⃣ PARTAGE AVEC UN GROUPE                                                 │
│     • Créer un groupe (ex: "SRE Team", "Trading Ops")                     │
│     • Ajouter des utilisateurs au groupe                                   │
│     • Partager la Map avec le groupe                                       │
│     • Tous les membres héritent des permissions                           │
│                                                                             │
│  3️⃣ PARTAGE PAR LIEN (optionnel)                                           │
│     • Générer un lien de partage                                           │
│     • Définir les permissions du lien (view only, operate)                │
│     • Optionnel: expiration, mot de passe                                 │
│     • Utile pour partage temporaire avec externes                         │
│                                                                             │
│  4️⃣ HÉRITAGE DE WORKSPACE                                                  │
│     • Les Maps héritent des permissions du Workspace                       │
│     • Override possible au niveau Map                                      │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  INTERFACE DE PARTAGE (UI)                                                 │
│  ═════════════════════════                                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📤 Partager "Trading Platform"                              [×]    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │ Propriétaire: john.doe@company.com                                 │   │
│  │                                                                     │   │
│  │ ┌─────────────────────────────────────────────────────────────┐   │   │
│  │ │ 🔍 Ajouter des personnes ou groupes...                      │   │   │
│  │ └─────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │ PERSONNES AVEC ACCÈS                                               │   │
│  │ ─────────────────────────────────────────────────────────────────  │   │
│  │                                                                     │   │
│  │ 👤 john.doe@company.com          Propriétaire        [Admin ▼]    │   │
│  │ 👤 alice.smith@company.com       SRE Team            [Operator ▼] │   │
│  │ 👤 bob.jones@company.com         Dev                 [Viewer ▼]   │   │
│  │ 👥 trading-ops (5 membres)       Groupe              [Operator ▼] │   │
│  │                                                                     │   │
│  │ ─────────────────────────────────────────────────────────────────  │   │
│  │                                                                     │   │
│  │ PERMISSIONS AVANCÉES                                [Développer ▼] │   │
│  │                                                                     │   │
│  │ ☐ Autoriser le re-partage                                         │   │
│  │ ☐ Notifier par email lors des incidents                           │   │
│  │                                                                     │   │
│  │                                    [Annuler]  [Enregistrer]        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.4 Permissions Fines par Action

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PERMISSIONS FINES PAR ACTION                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Il est possible de définir des permissions TRÈS granulaires:              │
│                                                                             │
│  EXEMPLE: Map "Trading Platform"                                           │
│  ════════════════════════════════                                          │
│                                                                             │
│  Utilisateur: alice@company.com                                            │
│  Rôle de base: Operator                                                    │
│                                                                             │
│  Permissions custom:                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │ COMPOSANTS                          START   STOP   RESTART  LOGS   │   │
│  │ ─────────────────────────────────────────────────────────────────  │   │
│  │ trading-api                          ✅      ✅      ✅       ✅    │   │
│  │ trading-worker                       ✅      ✅      ✅       ✅    │   │
│  │ postgresql                           ✅      ❌      ❌       ✅    │   │
│  │ redis                                ✅      ❌      ❌       ✅    │   │
│  │ kafka                                ❌      ❌      ❌       ✅    │   │
│  │                                                                     │   │
│  │ Note: Alice peut démarrer PostgreSQL mais pas l'arrêter            │   │
│  │       (protection contre les arrêts accidentels de la DB)          │   │
│  │                                                                     │   │
│  │ ACTIONS CUSTOM                                             EXECUTE │   │
│  │ ─────────────────────────────────────────────────────────────────  │   │
│  │ trading-api > clear_cache                                    ✅    │   │
│  │ trading-api > flush_orders                                   ❌    │   │
│  │ postgresql > backup                                          ✅    │   │
│  │ postgresql > restore                                         ❌    │   │
│  │ postgresql > vacuum                                          ✅    │   │
│  │                                                                     │   │
│  │ Note: Alice peut lancer un backup mais pas un restore              │   │
│  │       (restore = opération dangereuse réservée aux admins)         │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  CONFIGURATION YAML                                                        │
│  ═════════════════                                                         │
│                                                                             │
│  # Dans la Map ou via l'API                                                │
│  permissions:                                                               │
│    - user: alice@company.com                                               │
│      role: operator                                                         │
│      overrides:                                                             │
│        # Restrictions sur certains composants                              │
│        - component: postgresql                                              │
│          deny: [stop, restart]                                             │
│        - component: redis                                                   │
│          deny: [stop, restart]                                             │
│        - component: kafka                                                   │
│          deny: [start, stop, restart]                                      │
│          allow: [view, logs]                                               │
│        # Restrictions sur certaines actions                                │
│        - component: trading-api                                            │
│          actions:                                                           │
│            flush_orders: deny                                              │
│        - component: postgresql                                             │
│          actions:                                                           │
│            restore: deny                                                   │
│                                                                             │
│    - group: trading-ops                                                    │
│      role: operator                                                         │
│      # Pas d'override = toutes les permissions operator                    │
│                                                                             │
│    - user: bob@company.com                                                 │
│      role: viewer                                                           │
│      # Bob ne peut que regarder                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.5 Schéma de Base de Données (Permissions)

```sql
-- ══════════════════════════════════════════════════════════════════════════
-- TABLES PRINCIPALES
-- ══════════════════════════════════════════════════════════════════════════

-- Organisations (Tenants)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    settings JSONB DEFAULT '{}'
);

-- Utilisateurs
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    avatar_url TEXT,
    auth_provider VARCHAR(50),  -- 'oidc', 'local', 'saml'
    auth_provider_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Appartenance à une organisation
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',  -- 'owner', 'admin', 'member'
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- Groupes
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

-- Membres des groupes
CREATE TABLE group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

-- Workspaces
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, slug)
);

-- Maps
CREATE TABLE maps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    owner_id UUID REFERENCES users(id),
    git_repo_url TEXT,
    git_branch VARCHAR(100) DEFAULT 'main',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, slug)
);

-- ══════════════════════════════════════════════════════════════════════════
-- PERMISSIONS
-- ══════════════════════════════════════════════════════════════════════════

-- Rôles prédéfinis
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,  -- 'viewer', 'operator', 'editor', 'admin'
    description TEXT,
    permissions JSONB NOT NULL  -- Liste des permissions du rôle
);

-- Permissions sur les Maps (utilisateurs)
CREATE TABLE map_permissions_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id UUID REFERENCES maps(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id),
    -- Overrides spécifiques (JSON)
    permission_overrides JSONB DEFAULT '{}',
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,  -- Optionnel: accès temporaire
    UNIQUE(map_id, user_id)
);

-- Permissions sur les Maps (groupes)
CREATE TABLE map_permissions_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id UUID REFERENCES maps(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id),
    permission_overrides JSONB DEFAULT '{}',
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(map_id, group_id)
);

-- Liens de partage (optionnel)
CREATE TABLE map_share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id UUID REFERENCES maps(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    role_id UUID REFERENCES roles(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    password_hash VARCHAR(255),  -- Optionnel
    max_uses INTEGER,
    use_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true
);

-- ══════════════════════════════════════════════════════════════════════════
-- DONNÉES INITIALES
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO roles (name, description, permissions) VALUES
('viewer', 'Lecture seule', '{
    "map": ["view"],
    "component": ["view", "logs"],
    "action": []
}'),
('operator', 'Opérations', '{
    "map": ["view"],
    "component": ["view", "start", "stop", "restart", "logs"],
    "action": ["execute"]
}'),
('editor', 'Modification', '{
    "map": ["view", "edit"],
    "component": ["view", "start", "stop", "restart", "logs", "edit"],
    "action": ["execute", "create", "edit", "delete"]
}'),
('admin', 'Administration', '{
    "map": ["view", "edit", "delete", "share", "admin"],
    "component": ["*"],
    "action": ["*"]
}'),
('restricted_operator', 'Opérations limitées (start only)', '{
    "map": ["view"],
    "component": ["view", "start", "logs"],
    "action": []
}');

-- ══════════════════════════════════════════════════════════════════════════
-- FONCTIONS UTILITAIRES
-- ══════════════════════════════════════════════════════════════════════════

-- Fonction pour vérifier si un utilisateur a une permission sur une Map
CREATE OR REPLACE FUNCTION check_map_permission(
    p_user_id UUID,
    p_map_id UUID,
    p_permission VARCHAR(100),
    p_component_id VARCHAR(255) DEFAULT NULL,
    p_action_name VARCHAR(255) DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_has_permission BOOLEAN := FALSE;
    v_role_permissions JSONB;
    v_overrides JSONB;
BEGIN
    -- 1. Vérifier les permissions directes de l'utilisateur
    SELECT r.permissions, mpu.permission_overrides
    INTO v_role_permissions, v_overrides
    FROM map_permissions_users mpu
    JOIN roles r ON r.id = mpu.role_id
    WHERE mpu.map_id = p_map_id 
      AND mpu.user_id = p_user_id
      AND (mpu.expires_at IS NULL OR mpu.expires_at > NOW());
    
    IF v_role_permissions IS NOT NULL THEN
        v_has_permission := check_permission_in_role(
            v_role_permissions, v_overrides, 
            p_permission, p_component_id, p_action_name
        );
        IF v_has_permission THEN RETURN TRUE; END IF;
    END IF;
    
    -- 2. Vérifier les permissions via les groupes
    SELECT r.permissions, mpg.permission_overrides
    INTO v_role_permissions, v_overrides
    FROM map_permissions_groups mpg
    JOIN roles r ON r.id = mpg.role_id
    JOIN group_members gm ON gm.group_id = mpg.group_id
    WHERE mpg.map_id = p_map_id 
      AND gm.user_id = p_user_id
    LIMIT 1;  -- Prend le premier groupe (TODO: merger les permissions)
    
    IF v_role_permissions IS NOT NULL THEN
        v_has_permission := check_permission_in_role(
            v_role_permissions, v_overrides,
            p_permission, p_component_id, p_action_name
        );
    END IF;
    
    RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql;
```

### 9.6 API REST - Permissions

```yaml
# Endpoints pour gérer les permissions

# ══════════════════════════════════════════════════════════════════════════
# PARTAGE DE MAP
# ══════════════════════════════════════════════════════════════════════════

# Liste les permissions d'une Map
GET /api/v1/maps/{mapId}/permissions
Response:
  {
    "owner": {
      "id": "uuid",
      "email": "john@company.com",
      "name": "John Doe"
    },
    "users": [
      {
        "user": { "id": "uuid", "email": "alice@company.com" },
        "role": "operator",
        "overrides": { ... },
        "grantedAt": "2026-01-15T10:00:00Z"
      }
    ],
    "groups": [
      {
        "group": { "id": "uuid", "name": "trading-ops", "memberCount": 5 },
        "role": "operator",
        "grantedAt": "2026-01-10T10:00:00Z"
      }
    ],
    "shareLinks": [
      {
        "id": "uuid",
        "token": "abc123...",
        "role": "viewer",
        "expiresAt": "2026-02-01T00:00:00Z",
        "useCount": 3
      }
    ]
  }

# Ajoute une permission utilisateur
POST /api/v1/maps/{mapId}/permissions/users
Body:
  {
    "email": "bob@company.com",  # ou "userId": "uuid"
    "role": "operator",
    "overrides": {
      "components": {
        "postgresql": { "deny": ["stop", "restart"] }
      },
      "actions": {
        "trading-api": { "flush_orders": "deny" }
      }
    },
    "expiresAt": "2026-06-01T00:00:00Z",  # Optionnel
    "sendInviteEmail": true
  }

# Modifie une permission utilisateur
PUT /api/v1/maps/{mapId}/permissions/users/{userId}
Body:
  {
    "role": "editor",
    "overrides": { ... }
  }

# Supprime une permission utilisateur
DELETE /api/v1/maps/{mapId}/permissions/users/{userId}

# Ajoute une permission groupe
POST /api/v1/maps/{mapId}/permissions/groups
Body:
  {
    "groupId": "uuid",
    "role": "operator"
  }

# ══════════════════════════════════════════════════════════════════════════
# LIENS DE PARTAGE
# ══════════════════════════════════════════════════════════════════════════

# Crée un lien de partage
POST /api/v1/maps/{mapId}/share-links
Body:
  {
    "role": "viewer",
    "expiresAt": "2026-02-01T00:00:00Z",
    "maxUses": 10,
    "password": "optional-password"
  }
Response:
  {
    "id": "uuid",
    "url": "https://app.opsmap.io/shared/abc123xyz",
    "token": "abc123xyz",
    "expiresAt": "2026-02-01T00:00:00Z"
  }

# Révoque un lien de partage
DELETE /api/v1/maps/{mapId}/share-links/{linkId}

# ══════════════════════════════════════════════════════════════════════════
# VÉRIFICATION DE PERMISSION
# ══════════════════════════════════════════════════════════════════════════

# Vérifie si l'utilisateur courant peut effectuer une action
GET /api/v1/maps/{mapId}/permissions/check
Query params:
  - permission: "component:stop"
  - componentId: "postgresql"  # Optionnel
  - actionName: "backup"       # Optionnel
Response:
  {
    "allowed": true,
    "reason": "Role 'operator' grants this permission"
  }
  # ou
  {
    "allowed": false,
    "reason": "Permission denied by override on component 'postgresql'"
  }

# Liste les permissions effectives de l'utilisateur courant sur une Map
GET /api/v1/maps/{mapId}/permissions/effective
Response:
  {
    "role": "operator",
    "effectivePermissions": {
      "map": ["view"],
      "components": {
        "trading-api": ["view", "start", "stop", "restart", "logs"],
        "postgresql": ["view", "start", "logs"],  # stop/restart denied
        "kafka": ["view", "logs"]
      },
      "actions": {
        "trading-api": {
          "clear_cache": true,
          "flush_orders": false
        },
        "postgresql": {
          "backup": true,
          "restore": false
        }
      }
    }
  }
```

### 9.7 Audit des Permissions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AUDIT DES PERMISSIONS                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Toutes les actions liées aux permissions sont auditées:                   │
│                                                                             │
│  • Permission accordée                                                      │
│  • Permission modifiée                                                      │
│  • Permission révoquée                                                      │
│  • Lien de partage créé/révoqué                                            │
│  • Tentative d'accès refusée                                               │
│                                                                             │
│  EXEMPLE D'ENTRÉE D'AUDIT:                                                 │
│  ═════════════════════════                                                 │
│                                                                             │
│  {                                                                          │
│    "id": "audit_123",                                                      │
│    "timestamp": "2026-01-31T10:15:00Z",                                    │
│    "action": "permission.denied",                                          │
│    "actor": {                                                               │
│      "type": "user",                                                       │
│      "id": "user_alice",                                                   │
│      "email": "alice@company.com",                                         │
│      "ip": "10.0.1.50"                                                     │
│    },                                                                       │
│    "target": {                                                              │
│      "type": "component",                                                  │
│      "mapId": "map_trading",                                               │
│      "componentId": "postgresql"                                           │
│    },                                                                       │
│    "details": {                                                             │
│      "attemptedAction": "stop",                                            │
│      "reason": "Permission denied by override",                            │
│      "userRole": "operator",                                               │
│      "override": { "deny": ["stop", "restart"] }                          │
│    }                                                                        │
│  }                                                                          │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  ALERTES                                                                   │
│  ═══════                                                                   │
│                                                                             │
│  Notifications configurables:                                               │
│  • N tentatives d'accès refusées → Alerte admin                           │
│  • Permission admin accordée → Notification propriétaire                   │
│  • Lien de partage utilisé N fois → Notification créateur                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.8 Intégration SSO/OIDC

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INTÉGRATION SSO/OIDC                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  OpsMap supporte l'authentification via:                                   │
│  • OpenID Connect (OIDC) - Azure AD, Okta, Keycloak, etc.                 │
│  • SAML 2.0 (Enterprise)                                                   │
│  • LDAP/Active Directory (Enterprise)                                      │
│                                                                             │
│  SYNCHRONISATION DES GROUPES                                               │
│  ════════════════════════════                                              │
│                                                                             │
│  Les groupes peuvent être synchronisés depuis l'IdP:                       │
│                                                                             │
│  Configuration:                                                             │
│  ```yaml                                                                   │
│  auth:                                                                      │
│    provider: oidc                                                          │
│    oidc:                                                                    │
│      issuer: "https://login.company.com"                                   │
│      client_id: "opsmap-client"                                            │
│      client_secret: "${OIDC_SECRET}"                                       │
│      scopes: ["openid", "profile", "email", "groups"]                     │
│                                                                             │
│    # Mapping des groupes IdP → OpsMap                                      │
│    group_mapping:                                                           │
│      # Groupe IdP → Groupe OpsMap                                          │
│      "CN=SRE-Team,OU=Groups,DC=company,DC=com": "sre-team"                │
│      "CN=Trading-Ops,OU=Groups,DC=company,DC=com": "trading-ops"          │
│                                                                             │
│    # Ou via pattern                                                        │
│    group_pattern: "^CN=([^,]+),OU=OpsMap"                                 │
│                                                                             │
│    # Auto-créer les groupes si absents                                     │
│    auto_create_groups: true                                                │
│  ```                                                                        │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  CLAIMS PERSONNALISÉS                                                      │
│  ═════════════════════                                                     │
│                                                                             │
│  OpsMap peut lire des claims custom pour les permissions:                  │
│                                                                             │
│  ```yaml                                                                   │
│  auth:                                                                      │
│    claims_mapping:                                                          │
│      # Rôle global depuis un claim                                         │
│      org_role: "opsmap_role"        # claim → 'admin', 'member'           │
│      # Workspaces autorisés depuis un claim                                │
│      workspaces: "opsmap_workspaces" # claim → ['prod', 'dev']            │
│  ```                                                                        │
│                                                                             │
│  Token JWT exemple:                                                        │
│  {                                                                          │
│    "sub": "alice@company.com",                                             │
│    "groups": ["SRE-Team", "Trading-Ops"],                                  │
│    "opsmap_role": "member",                                                │
│    "opsmap_workspaces": ["production", "staging"]                         │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Roadmap

### Phase 1: MVP (8 semaines)
- [ ] Agent Rust avec process detachment
- [ ] Gateway Rust basique
- [ ] Backend Node.js avec API REST
- [ ] mTLS complet
- [ ] Auto-découverte
- [ ] Commandes natives essentielles
- [ ] Frontend Dashboard basique
- [ ] Authentification basique (email/password)

### Phase 2: Core Features (8 semaines)
- [ ] Toutes les commandes natives
- [ ] GitOps (Maps versionnées)
- [ ] Visualisation Mermaid
- [ ] Gestion obsolescence
- [ ] Branch repair
- [ ] Audit trail complet
- [ ] Partage de Maps (utilisateurs)
- [ ] Rôles prédéfinis (Viewer, Operator, Editor, Admin)

### Phase 3: Enterprise (8 semaines)
- [ ] AI Connector Generator
- [ ] Prédiction temps démarrage
- [ ] Détection anomalies
- [ ] SSO (OIDC/SAML)
- [ ] RBAC complet avec permissions fines
- [ ] Groupes et sync LDAP/AD
- [ ] Helm charts / OpenShift

### Phase 4: Scale (8 semaines)
- [ ] Intelligence collective
- [ ] Gateway HA
- [ ] Multi-tenant complet
- [ ] OpsMap Cloud
- [ ] Liens de partage
- [ ] Documentation complète

---

## 12. Prompts Claude Code

### Prompt 1: Initialisation

```
Je démarre le projet OpsMap. Lis docs/opsmap-spec-v3.md.

Crée la structure du monorepo:
- /backend (Node.js/TypeScript)
- /agent (Rust, Cargo workspace)
- /gateway (Rust, même workspace)
- /frontend (React/Vite/Tailwind)
- /deploy (Docker, K8s)
- /docs

Configure:
- Rust workspace avec agent + gateway
- Backend TypeScript strict
- CI/CD avec scan sécurité (Trivy)
- Docker multi-stage distroless
```

### Prompt 2: Agent Rust - Core

```
Dans /agent, implémente:

1. Le système de process detachment (double-fork)
   - Voir section 2.2 de la spec
   - Tests unitaires qui vérifient que le processus survit au kill de l'agent

2. La connexion WebSocket à la Gateway
   - mTLS obligatoire
   - Reconnexion automatique
   - Heartbeat

3. Les commandes natives de base:
   - OsInfo, DiskSpace, MemoryUsage, CpuLoad
   - ServiceStatus, ServiceStart, ServiceStop
```

### Prompt 3: Gateway Rust

```
Dans /gateway, implémente:

1. Serveur WebSocket pour les agents (mTLS)
2. Client WebSocket vers le backend (mTLS)  
3. Registre des agents avec auto-découverte
4. Routage des commandes
5. Agrégation des heartbeats
```

### Prompt 4: Backend Core

```
Dans /backend, implémente:

1. Gestionnaire de connexions aux Gateways
2. API REST pour:
   - Lister gateways/agents
   - Envoyer commandes
   - Récupérer résultats
3. WebSocket pour temps réel vers le frontend
4. Intégration xcomponent-ai pour FSM
```

Continues avec les prompts pour chaque phase...
