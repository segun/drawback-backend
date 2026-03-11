# Child Sexual Abuse and Exploitation (CSAE) Standards

**Drawback - CSAE Prevention and Response Standards**  
*Last Updated: March 11, 2026*

## 1. Zero Tolerance Policy

Drawback maintains a **zero-tolerance policy** regarding child sexual abuse and exploitation (CSAE). We are committed to preventing, detecting, and eliminating any content or behavior that exploits, endangers, or sexualizes minors.

### 1.1 Prohibited Content and Conduct

The following are strictly prohibited on our platform:

- Any visual depictions, descriptions, or solicitation involving minors in sexually explicit or suggestive contexts
- Grooming behavior or attempts to establish inappropriate relationships with minors
- Sharing, requesting, or facilitating access to child sexual abuse material (CSAM)
- Age-inappropriate sexual content or conversations directed at minors
- Attempts to obtain personal information from minors for exploitative purposes
- Sexualized imagery, even if cartoon or AI-generated, depicting minors
- Links to external sites containing CSAM or child exploitation content

## 2. Detection and Prevention Mechanisms

### 2.1 Proactive Safeguards

- **User Registration**: Email verification required for all accounts
- **Content Moderation**: Real-time monitoring of drawing sessions and chat messages
- **Automated Detection**: Implementation of hash-matching technology to detect known CSAM
- **User Blocking**: Users can block others and control their visibility (PUBLIC/PRIVATE modes)
- **Chat Request System**: Opt-in communication model requiring explicit acceptance before private sessions

### 2.2 Technical Measures

- All drawing data and chat messages are retained for investigation purposes
- IP addresses and session metadata logged for law enforcement cooperation
- Rate limiting and throttling to prevent mass distribution
- Secure data transmission (HTTPS/WSS) with audit trails
- Regular security audits and penetration testing

## 3. Reporting Mechanisms

### 3.1 User Reporting

Users can report concerning content or behavior through:

- **In-App Reporting**: `POST /api/reports` endpoint with report details (report type, description, user being reported, session context)
- **Application Interface**: Available within the application UI for easy access
- **Email**: Report to `safety@drawback.app` or `abuse@drawback.app`
- **Emergency Hotline**: For urgent situations requiring immediate action

All reports are:
- Stored in our database with full audit trail and timestamps
- Received and reviewed within **24 hours**
- Investigated by trained safety personnel
- Kept confidential to protect reporter identity
- Actioned immediately if CSAE content is confirmed
- Tracked with status updates (Pending → Under Review → Resolved/Dismissed)

### 3.2 Anonymous Reporting

We accept anonymous reports via email and do not require user accounts to submit safety reports via email. For in-app reporting, authentication is required to prevent abuse of the reporting system. Reporter information is protected and never disclosed to reported parties.

## 4. Investigation and Response

### 4.1 Investigation Process

When CSAE content or behavior is reported or detected:

1. **Immediate Action**: Suspected CSAM is immediately removed and isolated
2. **Preservation**: All related data (user info, content, metadata) is preserved
3. **Review**: Trained personnel conduct thorough investigation within 24 hours
4. **Escalation**: Confirmed cases are escalated to legal and law enforcement teams
5. **Documentation**: Complete audit trail maintained for legal proceedings

### 4.2 Response Timeline

- **Suspected CSAM**: Removed within 1 hour of detection
- **Confirmed CSAM**: Reported to NCMEC within 24 hours
- **Account Suspension**: Immediate for confirmed violations
- **Law Enforcement Notification**: Within 24 hours for confirmed cases

## 5. Enforcement Actions

### 5.1 Account Actions

Violations result in immediate enforcement:

- **Permanent Ban**: All accounts involved in CSAE violations
- **Device Ban**: Prevention of re-registration from same devices
- **IP Blocking**: Network-level blocking where appropriate
- **Content Removal**: Complete deletion of violating content
- **Access Restriction**: Blocked from creating new accounts

### 5.2 No Warnings

CSAE violations result in **immediate permanent bans** without prior warnings. Users are not notified of the ban reason to prevent evidence tampering.

## 6. Cooperation with Law Enforcement

### 6.1 Mandatory Reporting

We comply with all legal obligations to report CSAE:

- **NCMEC (National Center for Missing & Exploited Children)**: Required CyberTipline reports
- **Local Law Enforcement**: Cooperation with investigations
- **International Agencies**: Compliance with Interpol, EUROPOL, and other international bodies
- **Legal Process**: Full compliance with subpoenas, warrants, and court orders

### 6.2 Data Preservation

Upon receiving legal requests or identifying CSAE:

- User account data preserved for minimum of **2 years**
- Content and metadata retained for investigative and legal purposes
- Secure chain of custody maintained for evidence integrity
- Coordinated disclosure with law enforcement to avoid compromising investigations

## 7. Age Verification and Minor Protection

### 7.1 Age Requirements

- **Minimum Age**: Users must be 13+ years old (or local age of digital consent)
- **Parental Consent**: Required for users under 18 in applicable jurisdictions
- **Age Verification**: Email verification and optional enhanced verification for sensitive features

### 7.2 Minor-Specific Protections

For users identified as minors:

- Default account mode set to PRIVATE
- Enhanced monitoring of incoming chat requests
- Restricted searchability in public user directories
- Parental controls and oversight options (where applicable)
- Educational resources about online safety

## 8. Staff Training and Accountability

### 8.1 Personnel Training

All staff with access to user content receive:

- **Mandatory CSAE Training**: Initial and annual refresher training
- **Recognition Training**: How to identify CSAE content and grooming behavior
- **Reporting Procedures**: Clear escalation paths and reporting requirements
- **Legal Compliance**: Understanding of legal obligations (18 U.S.C. § 2258A, etc.)
- **Trauma Support**: Access to counseling for staff exposed to disturbing content

### 8.2 Access Controls

- Minimum necessary access principle
- Two-person review for sensitive content
- Audit logs of all content access
- Regular access reviews and revocations

## 9. Transparency and Accountability

### 9.1 Regular Reporting

We commit to publishing annual transparency reports including:

- Number of CSAE reports received
- Response times and actions taken
- Law enforcement requests and responses
- Platform safety improvements implemented

### 9.2 External Audits

- Annual third-party security audits
- Regular review of CSAE prevention measures
- Participation in industry working groups (Technology Coalition, INHOPE, etc.)
- Compliance assessments against international standards

## 10. User Education

### 10.1 Safety Resources

We provide users with:

- **Safety Center**: Dedicated resources on online safety and CSAE prevention
- **In-App Safety Tips**: Contextual guidance on safe platform use
- **Parental Guidance**: Resources for parents monitoring minor usage
- **Crisis Resources**: Links to hotlines and support organizations

### 10.2 Community Guidelines

Clear, accessible community guidelines that explicitly prohibit CSAE and explain consequences. Published at `https://drawback.app/community-guidelines`

## 11. Continuous Improvement

### 11.1 Technology Enhancement

We continuously invest in:

- PhotoDNA and hash-matching database expansion
- Machine learning models for CSAE detection
- Behavioral analysis for grooming detection
- Collaboration with industry on emerging threats

### 11.2 Policy Review

These standards are reviewed and updated:

- **Quarterly**: Internal policy reviews
- **Annually**: Comprehensive external audit
- **As Needed**: In response to new threats, technologies, or legal requirements

## 12. Contact Information

### 12.1 Safety Team

- **Email**: `safety@drawback.app`
- **Abuse Reports**: `abuse@drawback.app`
- **Legal/Law Enforcement**: `legal@drawback.app`

### 12.2 Emergency Resources

**If you or someone you know is in immediate danger, contact local emergency services (911 in the US).**

- **NCMEC CyberTipline**: 1-800-843-5678 or [CyberTipline.org](https://www.cybertipline.org)
- **FBI Internet Crime Complaint Center**: [ic3.gov](https://www.ic3.gov)
- **INHOPE Hotline**: [inhope.org](https://www.inhope.org)

## 13. Legal Framework

These standards comply with:

- 18 U.S.C. § 2258A (CSAM reporting requirements)
- 18 U.S.C. § 2252 (Child pornography prohibitions)
- Children's Online Privacy Protection Act (COPPA)
- General Data Protection Regulation (GDPR) - special category data for minors
- Digital Services Act (DSA) - obligations regarding illegal content
- Local and international laws governing child protection

## 14. Commitment Statement

Drawback is committed to providing a safe platform for creative collaboration. Protecting children from abuse and exploitation is our highest priority. We will continue to strengthen our safeguards, cooperate fully with law enforcement, and hold violators accountable to the fullest extent possible.

**These standards are a living document and will be updated to reflect evolving best practices, technology capabilities, and legal requirements.**

---

**Document Version**: 1.0  
**Effective Date**: March 11, 2026  
**Next Review Date**: June 11, 2026  
**Owner**: Drawback Safety and Trust Team

For questions about these standards, contact: `safety@drawback.app`
