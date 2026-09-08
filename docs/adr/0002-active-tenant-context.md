# ADR-0002 Active tenant context

**Status:** accepted  
**CR:** CR-001

Do not resolve tenant with `ORDER BY created_at LIMIT 1` on every request.

Store `user_active_tenant` and validate membership. Users with multiple ISPs switch explicitly.
