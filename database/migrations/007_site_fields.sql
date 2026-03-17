-- Migration 007 — Add SiteNumber and ContractNumber to Sites
-- Run this against an existing database. schema.sql already includes these columns for fresh installs.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Sites') AND name = 'SiteNumber')
    ALTER TABLE Sites ADD SiteNumber NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Sites') AND name = 'ContractNumber')
    ALTER TABLE Sites ADD ContractNumber NVARCHAR(100) NULL;
