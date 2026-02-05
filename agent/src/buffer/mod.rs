//! Offline buffer module
//!
//! Buffers data when the agent is disconnected from the Gateway.
//! Data is persisted to disk to survive agent restarts.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use tracing::{debug, error, info, warn};

/// Offline buffer for storing data when disconnected
pub struct OfflineBuffer {
    queue: VecDeque<serde_json::Value>,
    max_size: usize,
    file_path: Option<String>,
}

impl OfflineBuffer {
    pub fn new(max_size: usize) -> Self {
        Self {
            queue: VecDeque::with_capacity(max_size.min(10000)),
            max_size,
            file_path: None,
        }
    }

    /// Create buffer with file persistence
    pub fn with_file(max_size: usize, file_path: &str) -> Self {
        let mut buffer = Self::new(max_size);
        buffer.file_path = Some(file_path.to_string());
        buffer.load_from_file();
        buffer
    }

    /// Push data to buffer
    pub fn push(&mut self, data: serde_json::Value) {
        if self.queue.len() >= self.max_size {
            // Remove oldest item
            self.queue.pop_front();
            warn!(max_size = self.max_size, "Buffer full, dropping oldest item");
        }

        self.queue.push_back(data);
        debug!(queue_size = self.queue.len(), "Added item to buffer");

        // Persist to file
        if self.file_path.is_some() {
            self.save_to_file();
        }
    }

    /// Pop data from buffer (FIFO)
    pub fn pop(&mut self) -> Option<serde_json::Value> {
        let item = self.queue.pop_front();

        if item.is_some() && self.file_path.is_some() {
            self.save_to_file();
        }

        item
    }

    /// Get current buffer size
    pub fn len(&self) -> usize {
        self.queue.len()
    }

    /// Check if buffer is empty
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    /// Clear the buffer
    pub fn clear(&mut self) {
        self.queue.clear();

        if let Some(ref path) = self.file_path {
            if let Err(e) = std::fs::remove_file(path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    error!(error = %e, path = %path, "Failed to remove buffer file");
                }
            }
        }
    }

    /// Load buffer from file
    fn load_from_file(&mut self) {
        let path = match &self.file_path {
            Some(p) => p,
            None => return,
        };

        if !Path::new(path).exists() {
            return;
        }

        match File::open(path) {
            Ok(file) => {
                let reader = BufReader::new(file);
                let mut count = 0;

                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            if let Ok(data) = serde_json::from_str(&l) {
                                if self.queue.len() < self.max_size {
                                    self.queue.push_back(data);
                                    count += 1;
                                }
                            }
                        }
                        Err(e) => {
                            warn!(error = %e, "Failed to read buffer line");
                        }
                    }
                }

                if count > 0 {
                    info!(count = count, "Loaded items from buffer file");
                }
            }
            Err(e) => {
                warn!(error = %e, path = %path, "Failed to open buffer file");
            }
        }
    }

    /// Save buffer to file
    fn save_to_file(&self) {
        let path = match &self.file_path {
            Some(p) => p,
            None => return,
        };

        // Ensure directory exists
        if let Some(parent) = Path::new(path).parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                error!(error = %e, "Failed to create buffer directory");
                return;
            }
        }

        match OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)
        {
            Ok(mut file) => {
                for item in &self.queue {
                    if let Ok(json) = serde_json::to_string(item) {
                        if let Err(e) = writeln!(file, "{}", json) {
                            error!(error = %e, "Failed to write to buffer file");
                            return;
                        }
                    }
                }
                debug!(items = self.queue.len(), "Saved buffer to file");
            }
            Err(e) => {
                error!(error = %e, path = %path, "Failed to open buffer file for writing");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_push_pop() {
        let mut buffer = OfflineBuffer::new(10);

        buffer.push(json!({"test": 1}));
        buffer.push(json!({"test": 2}));

        assert_eq!(buffer.len(), 2);

        let item = buffer.pop().unwrap();
        assert_eq!(item["test"], 1);

        let item = buffer.pop().unwrap();
        assert_eq!(item["test"], 2);

        assert!(buffer.is_empty());
    }

    #[test]
    fn test_max_size() {
        let mut buffer = OfflineBuffer::new(2);

        buffer.push(json!({"test": 1}));
        buffer.push(json!({"test": 2}));
        buffer.push(json!({"test": 3})); // Should drop oldest

        assert_eq!(buffer.len(), 2);

        let item = buffer.pop().unwrap();
        assert_eq!(item["test"], 2); // First item should be dropped
    }
}
